import { transformViewerState } from './PushPins3D/PushPinViewerState';
import { findMatchingModel } from './PushPinItem';

// Helper function used for saving viewerStates in PushPin attributes:
// For backward compatibility, the globalOffset of the viewerState is always equal to the center of the model bbox. Here 'model'
// is the model that the issue has been created for.
// This corresponds to the default globalOffset when using globalOffset=undefined and applyRefPoint=false in the model options.
//  @param {av.Model} model for which the PushPin was created
const getLegacyGlobalOffset = model => {
    // The goal here is to reproduce the default globalOffset that LMV would choose for the case
    // globalOffset=undefined and applyRefPoint=false.
    //
    // It is essential NOT to use model.getBoundingBox(): Only the box in the metadata is unaffected by
    // any lmv load-time transforms.
    const boxData = model && model.myData.metadata['world bounding box'];
    const pMin = boxData.minXYZ;
    const pMax = boxData.maxXYZ;
    return {
        x: 0.5 * (pMin[0] + pMax[0]),
        y: 0.5 * (pMin[1] + pMax[1]),
        z: 0.5 * (pMin[2] + pMax[2])
    };
};

// For legacy reasons, location and viewerState from issue-backend are stored in viewer-coordinates assuming that a single
// model has been loaded with default load-options in LMV, i.e.,
//  - Global offset is at the center of the model for which the issue was created.
//  - No refPointTransform or custom transform/scaling was applied in loadOptions
//
// These conditions are true in single-model viewers like BIM360Docs Viewer,
// but not in aggregated viewers like ModelCoordination and DesignCollaboration.
// To make it for all viewers in the same way, we convert position and viewerState
// in model-local coords - which are independent of load-time transforms.
// 
// @param {Object} pushPinData - pushPin data with position and viewerState. Conversion works in-place.
export const legacyToLocalPushPinData = (pushPinData, viewer) => {

    // Get globalOffset. Note that not all pushpins contain viewerState.
    let offset = pushPinData.viewerState && pushPinData.viewerState.globalOffset;

    // Legacy-fallback: (consider removal of this section in April 2020)
    //   Older Issues may not have stored the globalOffset attribute, so some information is lost.
    //   For these, we have to 'recover' it using some guesswork. To avoid regression, we assume here
    //   that the issue has been created with the same globalOffset as it is viewed. The old code had
    //   made this assumption implicitly too - so it will keep the scenarios working that had worked before.
    if (!offset) {
        // Note that consistent model placement requires globalOffset to be the same for all models.
        // So, it's okay to just use viewer.model - even for aggregated views.
        offset = viewer.model && viewer.model.myData.globalOffset;
    }

    // Convert position to model-local coords
    if (offset) {
        pushPinData.position.x += offset.x;
        pushPinData.position.y += offset.y;
        pushPinData.position.z += offset.z;
    }

    // Note: Unlike position, the viewerState (eye, target, up etc.) is already in model-local coordinates, so we don't need to add anything here.
};

// Converts PushPinData from local coordinates to legacy format - to ensure compatibility with issues that were saved before introducing model-local coordinates.
const localToLegacyPushPinData = (pushPinData, model) => {
    // If there is no saved viewerState, there is nothing to convert;
    if (!pushPinData.viewerState) {
        return;
    }

    // For backward compatibility, the globalOffset is always at the center of the model. (see getLegacyGlobalOffset for details)
    pushPinData.viewerState.globalOffset = getLegacyGlobalOffset(model);

    // For backward compatibility, the model-local coords are not stored directly in position. Instead the convention is
    // model-local position is obtained by 'data.position + data.viewerState.globalOffset'. Therefore, we must subtract the globalOffset
    // before saving.
    pushPinData.position.x -= pushPinData.viewerState.globalOffset.x;
    pushPinData.position.y -= pushPinData.viewerState.globalOffset.y;
    pushPinData.position.z -= pushPinData.viewerState.globalOffset.z;
};

const getModelLocalBox = (model) => {
    const boxData = model && model.myData.metadata['world bounding box'];
    let box = new THREE.Box3();
    box.min.fromArray(boxData.minXYZ);
    box.max.fromArray(boxData.maxXYZ);
    return box;
};

// Heuristic to detect PushPins that were written while in DesignCollaboration before the positions were fixed.
// For these, position and camera will be far outside the actual model and need some auto-correction to keep correct.
const isOldDCPushPin = (model, data) => {

    // For new issues or old ones from Docs viewer, the pushpin position is given in model-local
    // coords and is usually inside the model box.
    // For old issues from Design Collaboration, the position will be far outside of the model-local box     
    const localBox = getModelLocalBox(model);
    const dist = localBox.distanceToPoint(data.position) * model.getUnitScale();
    
    // If the point is more than 100m outside, consider it as an old design collaboration issue.
    // A valid issue should always be within the model box. The length of 100m is just some heuristic choice
    // to identify "clearly far outside".
    if (dist < 100) {
        return false;
    }
    
    // Verify that the fallback would actually provide a valid position: If the issue was actually written
    // by design-collaboration before we fixed the positions, the position should be valid when interpreted 
    // as world coords.
    const viewerBox = model.getBoundingBox();
    const pWorld = new THREE.Vector3().copy(data.position);

    if (data.viewerState && data.viewerState.globalOffset) {
        pWorld.sub(data.viewerState.globalOffset);
    }

    return viewerBox.containsPoint(pWorld);
};

const fixOldDCPushPin = (model, data) => {

    // get matrix to convert position from world coords to model-local coords
    const modelLocalToWorld = model.myData.placementTransform;
    const worldToModelLocal = modelLocalToWorld && modelLocalToWorld.clone().invert();

    // If there is a placement transform & viewerState, transform pos and viewerState from world to model-local coords.
    // If there is no placement transform or viewerState, there is nothing todo.
    if (modelLocalToWorld && data.viewerState) {
        // transform pos
        data.position = new THREE.Vector3().copy(data.position).applyMatrix4(worldToModelLocal);

        // transform viewer state
        data.viewerState = JSON.parse(JSON.stringify(data.viewerState));
        transformViewerState(data.viewerState, worldToModelLocal);
    }
};

// Gets the in-memory reporesentation of a PushPinItem and returns the data in a way that is compatible with the 
// issues saved to issues-backend. For 2D, it is just the original PushPinData. For 3D, we have to apply some coordinate transforms.
export const getLegacyPushPinData = (pushPin, viewer) => {

    // Check whether we are editing in 2D or 3D. Actually it would be safer to check this on the pushPin, 
    // but they don't contain any information about this.
    const is3d = viewer.model && viewer.model.is3d();
    if (!is3d) {
        // For 2D, we are done here (no modifications needed).
        return pushPin.data;
    }

    // Internally, PushPinItem stores positions in viewer-coords and viewer states in world-coords.
    // Both depend on the model-load options used in the current viewer application, i.e., would not allow issues
    // between different viewing applications.
    //
    // In the PushPinAttributes, we store everything in model-local coords. These coordinates are not affected by any load-time transform.
    // Therefore, they are always the same for different LMV clients - no matter which loadOptions they are using. Also, it
    // ensures that the issues automatically "follows" the model in case the refPointTransform changed.
    let data = pushPin.getLocal(viewer);

    // When using getLocal(), position and viewerState (eye, target, ..) are consistently given in model-local coords. In a perfect world, we were done now.
    // But, for backwards compatibility with previously existing issues, we need some legacy conversions before storing the data.

    // For backward compatibility, the globalOffset is always at the center of the model. (see getLegacyGlobalOffset for details)
    const model = pushPin.findModel(viewer);
    if (!model) {
        console.error('Saving issue attributes failed: Issue must be assigned to a visible model.');
        return pushPin.data;
    }

    // Convert from model-local coords to legacy PushPins: For backward compatility, they PushPin position must match with the viewer
    // position when viewing a single model with default loadOptions (default globalOffset, no transforms).
    localToLegacyPushPinData(data, model);

    return data;
};

//
// The purpose of this function is to avoid regressions for issues that have been created...
//  - using Design Collaboration
//  - written before we made the issue positions and viewerStates compatible with BIM360Docs viewer.
//
// For these issues, PushPin positions and viewerState will be world-coords. In the past, they had worked - but only under
// the assumption that an issue is viewed under exactly the same conditions (globalOffset, model placement etc.) in which it was created.
//
// The heuristic in this section is making sure that this case keeps working - by converting position and viewerState to model-local coordinates.
//
// Note: This fallback is not needed for viewers that use LMV default loadOptions like BIM360Docs viewer.
//
// @param {Object} data - PushPinData. Same as in PushPinExtension.createItem(..). Will be modified in-place if needed.
// @param {Viewer3D} viewer
export const applyLegacyFallback = (data, viewer) => {
    // If there is no saved viewerState, there is nothing we can do.
    if (!data.viewerState) {
        return;
    }

    // find model that the pushpin belongs to
    const model = findMatchingModel(viewer, data.viewerState.seedUrn);
    if (!model) {
        return;
    }
    
    // Apply fallback only if we know for sure that the PushPin position would be broken otherwise.
    if (!isOldDCPushPin(model, data)) {
        return;
    }

    // Transform position and viewerState
    fixOldDCPushPin(model, data);
};
