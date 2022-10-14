'use strict';

const av = Autodesk.Viewing;
const avp = Autodesk.Viewing.Private;
const namespace = AutodeskNamespace('Autodesk.AEC');
import FloorSelectorFilter from './FloorSelectorFilter.js';

// FloorSelector provides graphics effects to be used by UI for floor selection.
//
// This includes:
//
//  - Setting cutplanes accordingly when a floor is selected.
//
//  - Animated transitions if the selected floor changes.
//
//  - Applying mouse-over highlighting of floors - to be used when hovering over a floor button
//
//  - "Ghost-Floors": By default, we render selected floors only. If the mouse enters the floor panel, we
//     also fade-in the other floors, but with strongly reduced opacity. (+ fade-out on mouse leave)
//
//
// How to use it:
//
//  1. Create a FloorSelector by passing the viewer to the ctor.
//
//  2. Before using the FloorSelector, you have to provide floor data that you get from the Revit metadata
//     json file. (see setFloorData comment)
//
//  3. Connect events for hovering over floor selector UI panel:
//     - Connect mouseover  to floorSelector.enterHoverMode()
//     - Connect mouseleave to floorSelector.existHoverMode()
//
//  4. Connect events for hovering over floor selection buttons: For each floor button...
//     - Connect mouseover  to floorSelector.rollOverFloor(floorIndex) - floorIndex must be the index into the floor array (see setFloorData)
//     - Connect mouseleave to floorSelector.rollOverFloor()
//
//  5. Connect floor selection button: For each floor button,
//     connect button mousedown to floorSelector.selectFloor(floorIndex, true)
//
//  6. If the set of visible models has changed
//
//  7. When discarding the FloorSelector (while keeping the Viewer alive), call FloorSelector dtor.
//
// How to enable the optional filtering of objects by dbIds per model provided by the AECModelData.json on level selection?
//
//  1. You have to provide floor filter data containing a Map of dbIds per model. The key has to be the model version URN (see setFloorFilterData).
//
//     Example on how to set the floor filter data:
//
//     const modelsDbIds = new Map();
//     modelsDbIds.set(model, [1, 2, 3, 4]);
//     var floorFilterData = {
//         modelsDbIds: modelsDbIds
//     };
//
//     floorSelector.setFloorFilterData(floorFilterData);
//
// How to control the calculated lower level boundary value by defining the levelHeightFactor factor? The factor is multiplied with the level height
// and added to the level minZ value. This newly calculated minZ value defines the lower level boundary used to filter the Floor and Ceiling elements.
//
//     Example on how to set the floor filter data with a levelHeightFactor:
//
//     const modelsDbIds = new Map();
//     modelsDbIds.set(model, [1, 2, 3, 4]);
//     var floorFilterData = {
//         modelsDbIds: modelsDbIds,
//         levelHeightFactor: 0.6 // Allowed values have to be within 0-1.
//     };
//
//     floorSelector.setFloorFilterData(floorFilterData);
//
// Technical requirements/restrictions to be aware of:
//
//  - Cross-Fading Support: FloorSelector uses LMV render target fading for some effects. For this, it activates
//    cross-fading support in LMV (if not active already). This requires 2 extra color targets, i.e.
//    consumes some additional GPU-side memory.
//
//  - Camera Movement: The camera should not be moving while using the floor selector.
//    This is because we partially use static images for the fading effects.
//    If the user moves the camera, we instantly switch off the ghost floors.
//
//  - SAO opacity: FloorSelector needs to temporarily hide SAO. For this, we have to overwrite SAO opacity
//    and recover it later. This requires that the SAO opacity is not changed in the meantime
//    while using the FloorSelector. Otherwise, it will cause a warning and may cause visual
//    artifacts.



// Time in seconds to fade in/out ghosted floors when hovering over the floor selector panel
const GhostFloorFadingTime = 0.5;

// Opacity for ghost floors when fade-in is finished.
const MaxGhostFloorOpacity = 0.2;

// These should actually be infinity and -infinity, but since the values are passed to a shader,
// we have to use large finite values instead. Setting as cutplane elevations actually corresponds to
// switching cutplanes off. But, changes the number of cutplanes triggers expesnive shader recompiles.
const MaxZLimit = 1e20;
const MinZLimit = -MaxZLimit;

// Internally used enum values for state management
const FloorRenderMode = {

    // mouse is hovering over a floor button
    Hovering:   0,

    // new floor has been selected and anim is running
    Transition: 1,

    // default rendering
    Off:        2
};

// Reserved floor-index constant to select all floors at once.
const AllFloors = -1;
const NoFloor   = undefined;

// Used for setCutPlane calls to lmv. This ensures that FloorSelector controls its own cutplanes,
// which is independent of other cutplane changes like from SectionTool.
const CutPlaneSetName = 'Autodesk.AEC.FloorSelector';

export default class FloorSelector {

    // @param {Viewer3D} viewer
    constructor(viewer) {

        av.EventDispatcher.prototype.apply(this);

        this._viewer = viewer;
        this._renderer = viewer.impl.renderer();

        // Make sure that ghost-floors are switched off as soon as the user starts navigating.
        // This is needed because the selected floor is just a static image when ghost-floors are shown.
        this._cameraMovedCB = this._interruptFading.bind(this);
        viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this._cameraMovedCB);

        // Stop panel-hover effect on viewer-resize: Ghost-floors use a static image overlay that becomes unusable
        // if the target size changes.
        this._viewerResizeCB = this._onViewerResized.bind(this);
        viewer.addEventListener(av.VIEWER_RESIZE_EVENT, this._viewerResizeCB);

        // If SAO is switched off, we have to switch off roll-over highlighting too.
        this._renderOptionsChangedCB = this._onRenderOptionsChanged.bind(this);
        viewer.addEventListener(av.RENDER_OPTION_CHANGED_EVENT, this._renderOptionsChangedCB);

        // callback for the floor selection filtering
        this._floorSelectionFilterToBeUpdated = this._runFloorSelectorFilterEventHandler.bind(this);
        viewer.addEventListener(av.MODEL_ADDED_EVENT, this._floorSelectionFilterToBeUpdated);
        viewer.addEventListener(av.OBJECT_TREE_CREATED_EVENT, this._floorSelectionFilterToBeUpdated);

        // callback for the unloading of disabled models
        this._modelUnloadingCB = this._runModelUnloadingEventHandler.bind(this);
        viewer.addEventListener(av.MODEL_UNLOADED_EVENT, this._modelUnloadingCB);

        // {Object[]} Contains the floor data. see setFloorData() comment.
        this._floors      = [];

        // current state (hover/transition/off)
        this._currentMode = FloorRenderMode.Off;
        this._hovering    = false; // used to track hovering state while in transition mode

        // current floor section (if cutplanes are active)
        this._floorSectionMin = undefined;
        this._floorSectionMax = undefined;

        // Determine z-range for "all-floors"
        // We determine that dynamically from the currently visible models.
        // Note that we need this value also for cutplane transitions - so we cannot
        // simply choose something arbitrarily far outside.
        this._zMinAllModels = undefined;
        this._zMaxAllModels = undefined;

        // {AnimControl} Needed to interrupt a running cutplane animation (see moveFloors)
        this._floorAnim = null;

        // {AnimControl} Needed to interrupt a runnign fade-in/out anim for ghost-floors
        this._fadeAnim = null;

        // Opacity of the render target that shows floors that are currently not selected ("ghost floors")
        // Always 0.0 if the extra target for ghost floors is not used.
        this._ghostFloorOpacity = 0.0;
        
        // {number|undefined} index of selected floor (or undefined if no floor is selected)
        this._currentFloor = undefined;

        // We render ghost-floors without AO, because AO cannot be smoothly faded out with them.
        // To activate AO, we need to 'backup' the current AO opacity and recover it later.
        this._aoVisible = true;
        this._aoOpacity = undefined; // if ao is blocked, we store the original ao opacity here to recover it later.

        this._floorSelectorFilter = new FloorSelectorFilter(this._viewer);
        this._floorFilterData = undefined;

        // Indicates if we are currently using mouse-over highlighting for a floor.
        this._floorRollOverActive = false;

        // Whether to use the ghosting effect
        this._fadeEnabled = true;

        // If disabled, make sure that cutplanes keep unset. This is needed to avoid side-effects on 2D views.
        this.enabled = true;

        // Maximum time in ms that we allow for rendering offline images for fading effects.
        // By default (undefined), we use the frameBudget of regular rendering.
        this.offscreenRenderBudget = undefined;

        this.fadingTime = GhostFloorFadingTime;
    }

    dtor() {
        if (this._viewer) {
            this._viewer.removeEventListener(av.CAMERA_CHANGE_EVENT,         this._cameraMovedCB);
            this._viewer.removeEventListener(av.VIEWER_RESIZE_EVENT,         this._viewerResizeCB);
            this._viewer.removeEventListener(av.RENDER_OPTION_CHANGED_EVENT, this._renderOptionsChangedCB);
            this._viewer.removeEventListener(av.OBJECT_TREE_CREATED_EVENT,   this._floorSelectionFilterToBeUpdated);
            this._viewer.removeEventListener(av.MODEL_ADDED_EVENT,           this._floorSelectionFilterToBeUpdated);
            this._viewer.removeEventListener(av.MODEL_UNLOADED_EVENT,        this._modelUnloadingCB);
            this._viewer = null;
        }
    }

    // -----------------
    // --- Main API ----
    // -----------------

    // Before selecting any floors, setFloorData() must be called to provide the elevation ranges
    // of all available floors.
    //  @param {Object[]} floors - data about available floors, each item f must contain two finite floats f.zMin < f.zMax
    get floorData() {
        return this._floors;
    }

    set floorData(floors) {
        // always reset the floor selector when floors data changes to avoid inconstancy
        this.resetState();
        this._floors = Array.isArray(floors) ? floors : [];

        this.fireEvent({type: FloorSelector.FLOOR_DATA_CHANGED, floorData: this._floors});
    }

    // sets back level isolation, selection filter and the floors.
    resetState() {
        // we have to clear the settings
        this._floors = [];
        this._selectFloor(NoFloor);
        this._clearFloorSection();
        this._floorSelectorFilter.clearFilter();
    }

    // Before any objects can be filtered using the FloorSelectorFilter, setFloorFilterData() must be called to
    // provide the array of Floor and Ceiling dbIds per model.
    //  @param {Object[]} floorFilterData - A floor filter data object containing an array of dbIds per model.
    get floorFilterData() {
        return this._floorFilterData;
    }

    set floorFilterData(floorFilterData) {
        this._floorFilterData = floorFilterData;
    }

    // Fades in the ghost-floors.
    // Triggered when floor selection begins, i.e., mouse is entering floor selector panel.
    enterHoverMode() {

        // make sure that the ghosted floors are in a static image,
        // so that we can move the solid floor
        if (this._currentMode !== FloorRenderMode.Transition) {
            this._setMode(FloorRenderMode.Hovering);
        }

        // track hovering state - so that we can recover it after transitions
        this._hovering = true;
    }

    // Fades out the ghost floors.
    // Triggered when floor selection ends, i.e., mouse is leaving the floor selector panel.
    // @param {boolean} [force] - will exit ghosting immediately even if during transition
    exitHoverMode(force) {

        // If a floor-transition is running, we only track the hover state and
        // set the mode when the transition has finished.
        if (this._currentMode !== FloorRenderMode.Transition || force) {
            this._setMode(FloorRenderMode.Off);
        }
        this._hovering = false;

        // make sure that no spatial filter for mouse-over highlight is set anymore, so that we don't
        // have side-effects on subsequent object selection.
        this._setSpatialFilterForRollOver();
    }
    
    setPanelHoverEffectEnabled(enabled) {
        this.exitHoverMode(true);
        this._skipFadeAnimations();
        this._fadeEnabled = enabled;
    }

    _getFadeExtension() {
        return this._fadeEnabled && this._viewer.getExtension('Autodesk.CrossFadeEffects');
    }

    // Ghosted display of inactive floors on panel hover is only supported if CrossFadeEffects extension is loaded
    _ghostFloorsEnabled() {
        return Boolean(this._getFadeExtension());
    }

    // Select for which floor rollOver highlighting is shown.
    //   @param {number} [floorIndex] must be either
    //                                a) a valid index into this.floors
    //                                b) a reserved constant (FloorSelector.AllFloors or FloorSelector.NoFloor)
    rollOverFloor(floorIndex) {

        // If we don't show ghost-floors, roll-over highlighting does not make much sense if only 1 floor is visible anyway.
        // It just looks confusing, because occasionally it would only be visible for the selected floor and some parts of others
        // that overlap the z-range a bit.
        const enabled = this._ghostFloorsEnabled() || this._currentFloor === NoFloor;

        // rollOver highlight is only possible if SAO is enabled and supported.
        const supported = this._renderer.spatialFilterForRollOverSupported();
        if (floorIndex === undefined || !supported || !enabled) {

            // switch off floor highlight
            this._setSpatialFilterForRollOver();
            this._renderer.rolloverObjectId(0);
            return;
        }

        // Activate roll-over highlighting for all objects
        this._renderer.rolloverObjectId(1);

        // restrict highlighting to floor range unless all floors are selected.
        this._setSpatialFilterForRollOver(floorIndex);

        // TODO: Clarify why this call is needed. It should actually not required to re-render here.
        this._viewer.impl.invalidate(false, true, true);
    }

    // Sets the currently visible floor.
    //  @param {number}   [floorIndex]    A valid index into the floor data array (see setFloors) selects a single floor.
    //                                    FloorSelector.NoFloor discards the floor selection => all floors visible.
    //  @param {bool}     [useTransition] If true, a short animation is used to morph between previous and new floor
    //  returns false in case no selection cannot be performed
    selectFloor(floorIndex, useTransition) {

        if (!this.floorSelectionValid(floorIndex)) {
            return;
        }

        if (useTransition) {
            this._moveToFloor(floorIndex);
        } else {
            this._selectFloor(floorIndex);
        }

        this._runFloorSelectorFilter();

        // If no ghosting is used, we disable rollOver highlighting if only a single floor is visible.
        if (!this._ghostFloorsEnabled()) {
            this.rollOverFloor();
        }

        this.fireEvent({type: FloorSelector.SELECTED_FLOOR_CHANGED, levelIndex: floorIndex});
    }

    // Gets the index of the current selected floor or FloorSelector.NoFloor
    get currentFloor (){
        return this._currentFloor;
    }

    // Returns whether a floorSelection can be performed with the specified floor
    // checks for valid value, whether floorData is available, the floor is already selected
    // and whether the floor is within the expected range.
    floorSelectionValid(newFloor = NoFloor){
        // force boolean
        return !!((Number.isInteger(newFloor) || newFloor === NoFloor)// not a valid value
          && (this.floorData && this.floorData.length !== 0)// has no floor data
          && this.currentFloor !== newFloor  // newFloor floor is not selected
          && (newFloor === NoFloor
             || (newFloor >= 0 || this.floorData.length > newFloor))); // new floor is in range;
    }

    // returns true if a dbId is either hidden by FloorSelectorFilter or fully outside the cutplanes
    isVisible(model, dbId) {

        // reused tmp variable
        if (!this._tmpNodeBox) {
            this._tmpNodeBox = new Float32Array(6);
        }

        // Determine zMin/zMax to ceck against. We could use _floorSectionMin/Max. But this would
        // make this function depending on current animation state. Since we don't want to do permanent
        // filter-updates during animations, we use currentFloor instead, which represents the target state - independent of animations.
        const floor = this._floors[this._currentFloor];
        if (floor === NoFloor) {
            // No floor selected => Nothing hidden
            return true;
        }

        const instanceTree = model.getInstanceTree();
        if (!instanceTree) {
            // If there is not instance tree, FloorSelectorFilter would have warned already if a floor was selected.
            return true;
        }

        // get zMin/zMax for this node
        let nodeBox = this._tmpNodeBox;
        instanceTree.getNodeBox(dbId, nodeBox);
        const nodeBoxZMin = nodeBox[2];
        const nodeBoxZMax = nodeBox[5];

        // Node is hidden if...
        //  a) outside the level's cutplanes, or
        //  b) hidden by levels filter
        const outsideCutplane = nodeBoxZMin > floor.zMax || nodeBoxZMax < floor.zMin;
        return !outsideCutplane && this._floorSelectorFilter.isVisible(model, dbId);
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this._applySelectedFloorSection();
    }

    // ------------------------
    // --- Internal methods ---
    // ------------------------

    _stopFloorAnim() {
        if (this._floorAnim) {
            this._floorAnim.stop();
            this._floorAnim = null;
        }
    }

    _stopFadeAnim() {
        if (this._fadeAnim) {
            this._fadeAnim.stop();
            this._fadeAnim = null;
        }
    }

    _skipFadeAnimations() {
        if (this._fadeAnim) {
            this._fadeAnim.skip();
            this._fadeAnim = null;
        }

        if (this._floorAnim) {
            this._floorAnim.skip();
            this._floorAnim = null;
        }
    }    

    _leaveHoverMode() {

        let fadeExt = this._getFadeExtension();
        if (!fadeExt) {
            // Nothing todo if ghosting effect is not used.
            return;
        }

        // release any baked images
        fadeExt.releaseFadingImage(0);
        fadeExt.releaseFadingImage(1);

        // make sure that model is rendered into default color target
        fadeExt.setModelTargetIndexForAll(undefined);

        // apply cutplanes according to currently selected floor
        this._applySelectedFloorSection();

        // we are now rendering real floors again,
        // so that we can switch SAO on again.
        this._setAOVisible(true);
    }

    // When rendering ghost-floors, the static part is always a static image.
    // Therefore, we have to skip the fading if the user moves the camera.
    _interruptFading() {

        // If we just left hover-mode, but the floors did not finish to fade out yet,
        // stop the anim and finish it immediately.
        if (!this._hovering && this._fadeAnim && this._fadeAnim.isRunning) {
            this._stopFadeAnim();
            this._leaveHoverMode();
        }
    }

    _onViewerResized() {
       this.forceImageRefresh();
    }
    
    forceImageRefresh() {
        // Stop any image-based hovering effects immediately, because the baked ghost-floor image has incorrect size now.
        const isHovering = this._hovering;
        
        this.exitHoverMode();
        this._skipFadeAnimations();

        // Restart hovering effect if mouse is still on the panel. Now using the new render target size.
        if (isHovering) {
            this.enterHoverMode();
            this._skipFadeAnimations();
        }
    }

    _onRenderOptionsChanged() {
        // Make sure that we stop using roll-over-floor highlight if the depth
        // target is not available anymore.
        if (this._floorRollOverActive && !this._renderer.spatialFilterForRollOverSupported()) {
            this.rollOverFloor();
        }
    }

    // Get array of all visible models
    _getVisibleModels() {
        const mq = this._viewer.impl.modelQueue();
        return mq.getModels();
    }

    // Updates min/max limits for cutplane z-level, based on the bboxes of all visible models
    _updateZLimits() {
        const models = this._getVisibleModels();

        this._zMinAllModels = MaxZLimit;
        this._zMaxAllModels = MinZLimit;
        for (let i=0; i<models.length; i++) {
            const model = models[i];
            const box   = model.getBoundingBox();

            this._zMinAllModels = Math.min(box.min.z, this._zMinAllModels);
            this._zMaxAllModels = Math.max(box.max.z, this._zMaxAllModels);
        }

        // make sure the range is valid also when no models are available
        if (this._zMinAllModels>this._zMaxAllModels) {
            this._zMinAllModels = MinZLimit;
            this._zMaxAllModels = MaxZLimit;
        }
    }

    _setAOVisible(visible) {
        if (visible === this._aoVisible) {
            return;
        }
        this._aoVisible = visible;

        const blendPass = this._renderer.getBlendPass();

        let newOpacity = 0.0;
        if (!visible) {
            // ao switched off => backup original ao opacity
            this._aoOpacity = blendPass.uniforms[ 'aoOpacity'].value;
        } else {

            // Opacity should be 0. Any other value indicates that it has been changed from
            // outside while ao was hidden by floor selector.
            const curOpacity = blendPass.uniforms[ 'aoOpacity'].value;
            if (curOpacity !== 0.0) {
                console.warn('ao opacity should not be changed while FloorSelector is in use.');
            }

            // ao switched on => recover original ao opacity
            newOpacity = this._aoOpacity;
        }

        this._renderer.setAOOptions(this._renderer.getAORadius(), this._renderer.getAOIntensity(), newOpacity);
    }

    // @param {number} val - float in [0,1]
    _setGhostFloorOpactiy(val) {

        // ghost-floors are always rendered into extra target 1
        const fadeExt = this._getFadeExtension();
        fadeExt && fadeExt.setCrossFadeOpacity(1, val);

        this._ghostFloorOpacity = val;

    }

    // Apply/Remove spatial filter that restricts rollOver highlighting to a single floor
    //  @param {number} If floorIndex is a valid index into this.floors, highlighting is restricted to that floor.
    //                  Otherwise, the spatial filter is switched off.
    _setSpatialFilterForRollOver(floorIndex) {

        let filter  = undefined;
        const floor = this._floors[floorIndex];

        const createSpatialFilter = (zMin, zMax) => {
            // Define filter to restrict rollOver highlighting to floor elevation range
            return 'bool spatialFilter(vec3 worldPos) { return (worldPos.z >= float(' + zMin + ') && worldPos.z <= float(' + zMax + ')); }';
        };

        if (floor) {
            filter = createSpatialFilter(floor.zMin, floor.zMax);
        } else if (floorIndex === FloorSelector.AllFloors) {
            filter = createSpatialFilter(this._zMinAllModels, this._zMaxAllModels);
        }

        this._renderer.setSpatialFilterForRollOver(filter);

        // If spatial filter is defined, make sure that ghost floors are always rendered to depth target.
        // Otherwise, the spatial filter for roll-over highlighting does not work.
        const fadeExt = this._getFadeExtension();
        fadeExt && fadeExt.crossFade.setSaoHeuristicEnabled(!filter);

        this._floorRollOverActive = !!filter;
    }

    _applyFloorSection(zMin, zMax) {

        // Do not allow any cutplane when disabled
        if (!this.enabled) {
            this._viewer.impl.setCutPlaneSet(CutPlaneSetName, null);
            return;
        }

        // reset the defined z values to the minimum in case the value is not specified
        if (!Number.isFinite(zMin)) {
            zMin = MinZLimit;
        }
        if (!Number.isFinite(zMax)) {
            zMax= MaxZLimit;
        }


        const planes = [new THREE.Vector4(0,0,-1,zMin), new THREE.Vector4(0,0,1,-zMax)];
        this._viewer.impl.setCutPlaneSet(CutPlaneSetName, planes);
    }

    // Set cut plane according to currently selected floor
    _applySelectedFloorSection() {

        // If no floor section is active, set cutplanes to maximum range.
        // Doing this instead of clearing them avoids the repeated shader recompile
        const zMin = (this._floorSectionMin !== undefined) ? this._floorSectionMin : MinZLimit;
        const zMax = (this._floorSectionMax !== undefined) ? this._floorSectionMax : MaxZLimit;
        this._applyFloorSection(zMin, zMax);
    }

    _setFloorSection(minElev, maxElev) {
        this._floorSectionMin = isNaN(minElev) ? undefined : minElev;
        this._floorSectionMax = isNaN(maxElev) ? undefined : maxElev;
        this._applySelectedFloorSection();
    }

    // Temporarily disable floor section cut planes. This is needed to render ghost floors.
    _clearFloorSection() {
        // Changing the number of cutplanes would cause a shader recompile.
        // To avoid that, we set dummy cutplanes instead.
        this._updateZLimits();
        this._applyFloorSection();
    }

    _setMode(mode) {

        if (mode === this._currentMode) {
            return;
        }
        this._currentMode = mode;

        if (mode === FloorRenderMode.Hovering) {

            const fadeExt = this._getFadeExtension();
            if (fadeExt) {

                // Take control over CrossFade effect.
                // NOTE: As long as the mouse is hovering over the LevelsPanel, we assume that no one else overtakes the crossFade effect. If the mouse leaves the LevelsPanel
                //       the ghost-floors a fading out. If the fading is needed for something else at that time, we skip the fading and drop the ghost floors immediately.
                fadeExt.acquireControl('FloorSelector', () => this._interruptFading());

                // Render snapshot of selected floors into target 0
                fadeExt.setModelTargetIndexForAll(undefined); // render to main target
                this._applySelectedFloorSection();        // set cutplanes according to selected floor
                this._renderer.rolloverObjectId(0);       // keep mouse-over highlighting out of the snapshot
                this._setAOVisible(true);                 // Make sure that the selected floors are rendered with AO
                fadeExt.renderFadingImage(0, this.offscreenRenderBudget); // render static snapshot of selected floors into extra target 0

                // show this snapshot at full opacity
                fadeExt.setCrossFadeOpacity(0, 1.0);

                // Render remaining floors...
                this._clearFloorSection();

                // ..into target 1
                fadeExt.setModelTargetIndexForAll(1);

                // before starting to fade-in the ghost-floors,
                // hide SAO. Otherwise, SAO of the ghost
                // floors would pop in at fade start.
                this._setAOVisible(false);

                // stop any prior fade-anim
                this._stopFadeAnim();

                // fade-in ghost floors (starting at the prior opacity)
                const onTimer = this._setGhostFloorOpactiy.bind(this);
                this._fadeAnim = avp.fadeValue(this._ghostFloorOpacity, MaxGhostFloorOpacity, this.fadingTime, onTimer);
            }
        } else if (mode === FloorRenderMode.Transition) {

            // protect ghost floors from clear
            const fadeExt = this._getFadeExtension();
            if (fadeExt) {
                fadeExt.setClearEnabled(1, false);

                // render into target 0 again
                fadeExt.setClearEnabled(0, true);
                fadeExt.setModelTargetIndexForAll(0);

                // make sure that target 0 has full opacity to make sure that floor keeps visible after moving to target 0
                fadeExt.setCrossFadeOpacity(0, 1.0);
            }

            // reactivate AO
            this._setAOVisible(true);

            // Render selected/moving floor...
            this._applySelectedFloorSection();

        } else if (mode === FloorRenderMode.Off) {

            // stop any prior fade-anim
            this._stopFadeAnim();

            // fade-out ghost floors (starting at current opacity)
            const onTimer    = this._setGhostFloorOpactiy.bind(this);
            const onFinished = this._leaveHoverMode.bind(this);
            this._fadeAnim = avp.fadeValue(this._ghostFloorOpacity, 0.0, this.fadingTime, onTimer, onFinished);
        }
    }

    _moveToFloor(floorIndex) {

        this._currentFloor = floorIndex;

        this._setMode(FloorRenderMode.Transition);

        const floor = this._floors[floorIndex];

        this._updateZLimits();

        const minElevStart = this._floorSectionMin===undefined ? this._zMinAllModels : this._floorSectionMin;
        const maxElevStart = this._floorSectionMax===undefined ? this._zMaxAllModels : this._floorSectionMax;
        const minElevEnd   = floor ? floor.zMin : this._zMinAllModels;
        const maxElevEnd   = floor ? floor.zMax : this._zMaxAllModels;

        const updateCutPlanes = (unitTime) => {
            const t = avp.smootherStep(unitTime);
            const minElev = avp.lerp(minElevStart, minElevEnd, t);
            const maxElev = avp.lerp(maxElevStart, maxElevEnd, t);

            this._setFloorSection(minElev, maxElev);

            // fade-out mouse over while animating
            const blendPass = this._renderer.getBlendPass();
            const uniform = blendPass.uniforms['highlightIntensity'];
            uniform.value = Math.min(uniform.value, 1.0 - t);
        };

        const onAnimEnd = () => {
            // leave transition mode to hovering or off
            const mode = (this._hovering ? FloorRenderMode.Hovering : FloorRenderMode.Off);
            this._setMode(mode);
        };

        // If another floor anim is in running, stop it first.
        this._stopFloorAnim();

        this._floorAnim = avp.fadeValue(0.0, 1.0, this.fadingTime, updateCutPlanes, onAnimEnd);
    }

    _selectFloor(floorIndex) {

        // Make sure that a previous anim does not overwrite the cutplanes again.
        this._stopFloorAnim();

        this._currentFloor = floorIndex;

        // Note that zMin/zMax may also be undefined if no floor is selected
        const floor = this._floors[floorIndex];

        // Set min/maxElev from floor or set both to undefined (for 'no floor selected')
        const minElev = floor ? floor.zMin : undefined;
        const maxElev = floor ? floor.zMax : undefined;

        this._setFloorSection(minElev, maxElev);
    }

    _runFloorSelectorFilter() {
        // Make sure all previously hidden objects are set to visible again.
        this._floorSelectorFilter.clearFilter();

        if(this._floorFilterData && this._currentFloor !== undefined) {
            const floor = this._floors[this._currentFloor];
            this._floorSelectorFilter.filter(this._floorFilterData, floor);
        }
    }

    _runFloorSelectorFilterEventHandler(event) {
        let model = event.model;

        if (!model.isObjectTreeLoaded()) {
            return;
        }
        if (!(this._floorFilterData && this._currentFloor !== undefined)) {
            // Handles the case when a level was deactivated while the model was not visible.
            // When activating again the model, we need to make sure that the previously
            // filtered elements are set to visible again.
            this._floorSelectorFilter.clearFilter();
            return;
        }
        this._runFloorSelectorFilter();
    }

    _runModelUnloadingEventHandler(event) {
        if (this._floorFilterData && this._currentFloor !== undefined) {
            this._floorSelectorFilter.unhideModel(event.model);
        }
    }

    // Used in order to re-render a floor section.
    invalidateFloorSelection(floorIndex) {
        // Reselect current floor.
        this._selectFloor(floorIndex);
        // This is needed in order to filter unwanted planes from the cut area.
        this._runFloorSelectorFilter();
    }

}

FloorSelector.AllFloors = AllFloors;
FloorSelector.NoFloor   = NoFloor;

FloorSelector.SELECTED_FLOOR_CHANGED = "selectedFloorChanged";
FloorSelector.FLOOR_DATA_CHANGED = "floorDataChanged";

namespace.FloorSelector = FloorSelector;
