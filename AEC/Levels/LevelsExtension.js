'use strict';

const av = Autodesk.Viewing, avu = av.UI;
const namespace = AutodeskNamespace('Autodesk.AEC');
const myExtensionName = 'Autodesk.AEC.LevelsExtension';

import FloorSelector from './FloorSelector';
import {modelDataOccluders, aecModelDataToLevels, chooseMainModel} from './LevelUtils';
import { ListPanel, ListPanelEvents } from "../ui/ListPanel";
import AecData from '../common/AecModelData.js';

// Options:
//   @param {bool} [autoDetectAecModelData = true]
//         Level selection requires data about existing floors. By default (true), these are extracted automatically:
//          - For a single model, we get them by calling Document.getAecModelData(bubbleNode).
//          - If multiple models with aecModelData are visible, we choose the largest one to define the levels.
//
//         If set to false, an application can (and has to) call setAecModelData() explicitly instead.
//  @param {bool} [ifcLevelsEnabled = false] - If enabled will try to extract levels for IFC models using heuristics.
export default class LevelsExtension extends av.Extension {
    constructor(viewer, options = {}) {
        super(viewer, options);

        this.container = this.options.panelUIContainers && this.options.panelUIContainers.levelsPanel;

        this._onCameraMoved = this._onCameraMoved.bind(this);
        this.onItemMouseEnter = this.onItemMouseEnter.bind(this);
        this.onItemMouseLeave = this.onItemMouseLeave.bind(this);
        this.onItemSelected = this.onItemSelected.bind(this);
        this.updateFloorsData = this.updateFloorsData.bind(this);

        this.doNotCreateUI = options.doNotCreateUI;
        this._currentLevel = undefined;
    }

    _onCameraMoved() {
        const currentLevel = this._mapCameraToLevel();

        if (!currentLevel)
            return;

        if (!this._currentLevel || (currentLevel.guid !== this._currentLevel.guid)) {
            this._currentLevel = currentLevel;
            this.viewer.dispatchEvent({ type: LevelsExtension.LEVEL_CHANGED, level: currentLevel });
        }
    }

    _mapCameraToLevel() {
        const floors = this.floorSelector.floorData;
        if (!floors.length) {
            return;
        }

        const currentElevation = this.viewer.impl.camera.position.z;

        if (currentElevation < floors[0].zMin) {
            return floors[0];
        }
        else if (currentElevation > floors[floors.length - 1].zMax) {
            return floors[floors.length - 1];
        }
        else {
            return floors.find(f => f.zMin <= currentElevation && f.zMax >= currentElevation);
        }
    }

    onToolbarCreated() {

        if (this.container) {
            //Add our button to the toolbar if host app did not ask to render UI in some other place
            return;
        }

        // Add levelsButton to modelTools. 
        // We can safely assume toolbar to exist, because onToolbarCreated() is only called if 
        // 1. GuiViewer is used and 2. the toolbar is ready.
        let toolbar    = this.viewer.getToolbar();
        let modelTools = toolbar.getControl(av.TOOLBAR.MODELTOOLSID);
        if (modelTools && this.levelsButton) {
            modelTools.addControl(this.levelsButton);
        }
    }

    onItemMouseEnter({ item }) {
        var levelIndex = item.index;

        // Selecting an already selected level again will unselect => i.e. all Floors will be shown.
        // Correspondingly, we trigger rollover highlighting for all floors when hovering over the selected level.
        if (levelIndex === this.floorSelector.currentFloor) {
            levelIndex = FloorSelector.AllFloors;
        }

        this.floorSelector.rollOverFloor(levelIndex);
        this.hoveredFloor = levelIndex;
    }

    onItemMouseLeave({ item }) {
        if (this.hoveredFloor === item.index) {
            this.hoveredFloor = undefined;
            this.floorSelector.rollOverFloor(FloorSelector.NoFloor);
        }
    }

    onItemSelected({ item }) {
        // on item selected
        let levelIndex = (item.index !== this.floorSelector.currentFloor ? item.index : undefined);
        this.floorSelector.selectFloor(levelIndex, true);
    }

    _createUI() {
        if(this.doNotCreateUI) return;
        
        this.levelsButton = new avu.Button("toolbar-levelsTool");
        this.levelsButton.setToolTip('Levels');
        this.levelsButton.icon.innerHTML = createLevelsIcon();

        const panelOptions = {
            enableCheckmark: true, // show checkmark at the end of selected items
        };

        this.levelsPanel = new ListPanel(this.container || this.viewer.container, 'LevelsPanel-' + this.viewer.id, 'Levels', panelOptions);
        this.levelsPanel.setGlobalManager(this.globalManager);

        if (!this.container) {
            // This ensures that the Panel keeps visible within the viewer canvas on resize.
            this.viewer.addPanel && this.viewer.addPanel(this.levelsPanel);
        }


        // Keep button-state consistent when pressing panel close
        this.levelsPanel.addVisibilityListener((visible) => {
            this.levelsButton.setState(visible ? avu.Button.State.ACTIVE : avu.Button.State.INACTIVE);
        });

        // allow client app to be notified on panel close
        this.levelsPanel.closer.addEventListener('click', () => {
            if (this.onPanelVisibilityToggled) {
                this.onPanelVisibilityToggled(false);
            }
        });

        this.levelsPanel.addEventListener(ListPanelEvents.ITEM_MOUSE_ENTER, this.onItemMouseEnter);

        this.levelsPanel.addEventListener(ListPanelEvents.ITEM_MOUSE_LEAVE, this.onItemMouseLeave);

        this.levelsPanel.addEventListener(ListPanelEvents.ITEM_SELECT, this.onItemSelected);

        // Handle hovering over panel
        this.levelsPanel.container.addEventListener("mouseenter", () => this.floorSelector.enterHoverMode());
        this.levelsPanel.container.addEventListener("mouseleave", () => this.floorSelector.exitHoverMode());

        // Keep selected item in-sync with selected Floor
        this.floorSelector.addEventListener(
            FloorSelector.SELECTED_FLOOR_CHANGED,
            () => this.levelsPanel.updateItemStates()
        );

        this.levelsPanel.setItemHandlers(
            (item) => (item.index === this.floorSelector.currentFloor),
            (item) => item.text
        );

        // Connect levelsButton
        this.levelsButton.onClick = () => {
            let visible = !this.levelsPanel.isVisible();
            this.levelsPanel.setVisible(visible);

            // allow client app to be notified
            if (this.onPanelVisibilityToggled) {
                this.onPanelVisibilityToggled(visible);
            }
        };
    }

    setAecModelData(aecModelData, model, isDataInWorldCoords) {

        if (aecModelData !== this.aecModelData
            || model !== this.currentModel
            || isDataInWorldCoords !== this.isDataInWorldCoords
        ) {
            this.aecModelData = aecModelData;
            this.isDataInWorldCoords = isDataInWorldCoords;
            this.currentModel = model;

            this.updateFloorsData();

            var levels = this.floorSelector.floorData;
            var items  = [];
            for (var i=0; i<levels.length; i++) {
                let level = levels[i];
                items.push({
                    text:  level.name,
                    index: i
                });
            }

            // list items in reverse order, because aecModelData levels are sorted by increasing z
            items.reverse();
            if(this.levelsPanel) {
                this.levelsPanel.setItems(items);
            }

            this._updateOccluderData();
        }
    }

    // By default, the transform applied to levelData is automatically from the currentModel.
    // This function is only needed if you have to set aecModelData and apply a transform without knowing the model.
    //  @param {Matrix4} transform - transform floorData to viewer coordinates (must include globalOffset)
    setFloorDataTransform(transform) {
        this.floorDataTransform = transform;
        this.updateFloorsData();
    }

    updateFloorsData() {
        // Backup currentFloor before changing floorData inner values.
        // It's important to backup it here, because whenever we set floorData, it immediately calls `resetState`.
        const currentFloor = this.floorSelector.currentFloor;

        if (this.aecModelData) {
            // If data is already in world coordinates, just use it as is.
            if (this.isDataInWorldCoords) {
                this.floorSelector.floorData = this.aecModelData;
            } else {
                // Otherwise, we need to apply model transform on the levels first.
                //
                // If placementTf is undefined, we use the refPointTransform of aecModelData.
                // Note that this is correct when using applyRefPoint=true and a globalOffset with z=0
                // for the model load options.
                const placementTf = this.currentModel?.getData()?.placementWithOffset || this.floorDataTransform;
                const modelTransform = this.currentModel?.getModelTransform();

                this.floorSelector.floorData = aecModelDataToLevels(this.aecModelData, placementTf, modelTransform);
            }

            // Invalidate section.
            this.floorSelector.invalidateFloorSelection(currentFloor);
        } else {
            this.floorSelector.floorData = [];
        }

        // Since changing model z offset can cause the camera position (aka "player") to be outside / inside of a level,
        // It's important to call _onCameraMoved here, so if a level has changed according to the new transform - it will trigger a LEVEL_CHANGED event.
        this._onCameraMoved();
    }

    _updateOccluderData() {
        // Make sure that occluder data is known if a main model is specified
        let occludersPerModel = this.aecModelData ? modelDataOccluders(this.viewer) : undefined;
        this.floorSelector.floorFilterData = occludersPerModel;
    }

    async load() {
        this.viewportsExtension = await this.viewer.loadExtension('Autodesk.AEC.ViewportsExtension');

        this.floorSelector = new FloorSelector(this.viewer);

        this.updateFloorSelector = async () => {
            if (!this.floorSelector) {
                return;
            }

            // auto-detect main model if not disabled
            let autoDetect = (this.options.autoDetectAecModelData !== false);
            if (autoDetect) {
                let isDataInWorldCoords = false;

                const model        = chooseMainModel(this.viewer, true); // Returns null when no model
                const bubbleNode   = model && model.getDocumentNode();
                let aecModelData = bubbleNode && await av.Document.getAecModelData(bubbleNode); // Returns null when no aec model data

                if (!aecModelData && model && model.getData().loadOptions.fileExt === 'ifc' && this.options.ifcLevelsEnabled) {
                    // Set momentarily to undefined until async computation is finished. Helps differentiate when it's
                    // still loading (undefined), from having no levels information (null)
                    this.setAecModelData(undefined, model);
                    aecModelData = await AecData.computeAecModelDataForIfc(model);
                }

                if (!aecModelData && bubbleNode && !this.options.useOnlyAecModelDataViewports) {
                    const generatedLevels = await this.viewportsExtension.generateLevelsFromViewports(bubbleNode);

                    if (generatedLevels.length) {
                        aecModelData = generatedLevels;

                        isDataInWorldCoords = true;
                    }
                }

                this.setAecModelData(aecModelData, model, isDataInWorldCoords);
            }

            this._updateOccluderData();

            // Make sure that cutplanes are disabled when in 2d views and reactivated in 3d
            // Todo: Check if we can move the MODEL_ADDED event at the end of addModel, so that we could simply use viewer.is2d here.
            var is3d = this.viewer.getVisibleModels().some(model => model.is3d());
            this.floorSelector.setEnabled(is3d);
        };

        this.viewer.addEventListener(av.MODEL_ROOT_LOADED_EVENT, this.updateFloorSelector);
        this.viewer.addEventListener(av.MODEL_UNLOADED_EVENT, this.updateFloorSelector);
        this.viewer.addEventListener(av.MODEL_ADDED_EVENT, this.updateFloorSelector);
        this.viewer.addEventListener(av.MODEL_TRANSFORM_CHANGED_EVENT, this.updateFloorsData);
        this.viewer.addEventListener(av.CAMERA_CHANGE_EVENT, this._onCameraMoved);
        this.viewportsExtension.addEventListener(Autodesk.AEC.ViewportsExtension.Events.VIEWPORT_DATA_FETCHED_EVENT, this.updateFloorSelector);

        this._createUI();
        this.updateFloorSelector();

        return true;
    }

    unload() {
        if (!this.container) {
            this.viewer.removePanel && this.viewer.removePanel(this.levelsPanel);
        }
        this.floorSelector.selectFloor(undefined, false);
        this.levelsPanel = null;

        if (this.updateFloorSelector) {
            this.viewer.removeEventListener(av.MODEL_ROOT_LOADED_EVENT, this.updateFloorSelector);
            this.viewer.removeEventListener(av.MODEL_UNLOADED_EVENT, this.updateFloorSelector);
            this.viewer.removeEventListener(av.MODEL_ADDED_EVENT, this.updateFloorSelector);
            this.viewer.removeEventListener(av.MODEL_TRANSFORM_CHANGED_EVENT, this.updateFloorsData);
            this.viewportsExtension.removeEventListener(Autodesk.AEC.ViewportsExtension.Events.VIEWPORT_DATA_FETCHED_EVENT, this.updateFloorSelector);
            this.updateFloorSelector = null;
        }

        this.viewer.removeEventListener(av.CAMERA_CHANGE_EVENT, this._onCameraMoved);
        this._currentLevel = null;

        this.floorSelector = null;

        this.aecModelData = null;
        this.currentModel = null;

        return true;
    }

    /**
     * Gets the extension state as a plain object. Invoked automatically by viewer.getState()
     * @param {object} viewerState - Object to inject extension values.
     */
    getState(viewerState) {
        if (!this.viewer.model || this.viewer.model.is2d()) {
            return;
        }

        const floor = this.floorSelector.currentFloor;
        viewerState.floorGuid = floor ? this.floorSelector.floorData[floor].guid : null;
    }

    /**
     * Restores the extension state from a given object. Invoked automatically by viewer.restoreState()
     * @param {object} viewerState - Viewer state.
     * @param {boolean} immediate - Whether the new view is applied with (true) or without transition (false).
     * @returns {boolean} True if restore operation was successful.
     */
    restoreState(viewerState) {
        // If floorGuid is undefined we should keep the extension as it is. (unlike null which means 'no levels') 
        if (viewerState.floorGuid === undefined) {
            return;
        }
        if (viewerState.floorGuid) {
            const floor = this.floorSelector.floorData.find(data => data.guid === viewerState.floorGuid);

            if (floor) {
                this.floorSelector.selectFloor(floor.index, false);
            }
        } else {
            this.floorSelector.selectFloor(FloorSelector.NoFloor, false);
        }

        return true;
    }

    // Returns a floor object {index, name}
    getCurrentLevel() {
        // If a level is selected, use that one and ignore camera z
        const fs = this.floorSelector;
        const level = fs.floorData[fs.currentFloor];
        if (level) {
            return level;
        }

        // No floor selected => determine based on camera z
        return this._mapCameraToLevel();
    }

    // index must be a valid FloorIndex
    getZRange(index) {
        const floor = this.floorSelector && this.floorSelector.floorData[index];

        // Cut everything above zMid of current floor
        const zMax = floor.zMin + 0.5 * (floor.zMax - floor.zMin);

        // Cut everything below zMid of the floor below
        // (Cutting below zMin keeps stairs to lower floors visible)
        const floorBelow = this.floorSelector.floorData[index-1];
        const zMin = floorBelow ? 0.5 * (floorBelow.zMin + floorBelow.zMax) : floor.zMin;

        return {zMin, zMax};
    }
}

const createLevelsIcon = () => {
    return [
        '<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
            '<g stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">',
            '<path d="M4 8 L12 3 L 20 8 L12 13Z"/>',
            '<path d="M4 12 L12 17 L 20 12"/>',
            '<path d="M4 16 L12 21 L 20 16"/>Ä',
            '</g>',
        '</svg>'
    ].join('');
};

namespace.LevelsExtension = LevelsExtension; // Makes it easier to get e.g. the version

LevelsExtension.LEVEL_CHANGED = "levelChanged";

// Register the extension with the extension manager.
Autodesk.Viewing.theExtensionManager.registerExtension(myExtensionName, LevelsExtension);
