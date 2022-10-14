const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');

import { transformViewerState } from './PushPins3D/PushPinViewerState';
import { ATTRIBUTES_VERSION } from './PushPinConstants';

const decodeUrn = (urn) => {
    urn = urn.replace(/-/g, '+');         // Convert '-' (dash) to '+'
    urn = urn.replace(/_/g, '/');         // Convert '_' (underscore) to '/'
    while(urn.length % 4) { urn += '='; } // Add padding '='

    try {
        return atob(urn);
    } catch {
        return null;
    }
};

// Extract the lineageID string from a base64-encoded version urn
// Example: dXJuOmFkc2sud2lwc3RnOmZzLmZpbGU6dmYuM3Q4QlBZQXJSSkNpZkFZUnhOSnM0QT92ZXJzaW9uPTI 
//          => (decoded) "urn:adsk.wipstg:fs.file:vf.3t8BPYArRJCifAYRxNJs4A?version=2"
//          => vf.3t8BPYArRJCifAYRxNJs4A
//
// An edge case that is being handled here is a seedUrn that has been created on offline mode.
// In this case, it might look like this: "OfflineFiles/dXJuOmFkc2sud2lwZW1lYTpkbS5saW5lYWdlOjRlV01pbFl5UkV1SEIzZHQxTHBNUWc/6/dXJuOmFkc2sud2lwZW1lYTpmcy5maWxlOnZmLjRlV01pbFl5UkV1SEIzZHQxTHBNUWc_dmVyc2lvbj02/output/0/0.svf".
const getLineageId = (encodedUrn) => {
    const parts = encodedUrn.split('/');

    let decodedPart = null;

    for (let i = parts.length - 1; i >= 0; i--) {
        decodedPart = decodeUrn(parts[i]);
        
        if (decodedPart && decodedPart.indexOf('file:') != -1) {
            break;
        } else {
            decodedPart = null;
        }
    }

    if (!decodedPart) {
        console.error('urn is not encoded correctly.');
        return null;
    }
    
    const start = decodedPart.indexOf('file:') + 'file:'.length; // skip prefix "urn:adsk.wipstg:fs.file:" resp. "urn:adsk.wipprod:fs.file:"
    const end   = decodedPart.indexOf('?');
    return decodedPart.substring(start, end);
};

// Returns the first visible model for which the lineageID is the same as for the given seedUrn.
// The is usually not more than 1 anyway, but not guaranteed to be. In case there are more (e.g. for diff), 
// the first matching model determines the issue position.
export const findMatchingModel = (viewer, seedUrn) => {

    const models = viewer.getVisibleModels();

    // Skip in case seedUrn is missing (a possible reason is that it was created externally)
    if (!seedUrn) {
        // In case seedUrn is missing from the viewerState for some reason - we can still have a fallback in case there is only a single visible model.
        // In that case, we can assume that the pushpin belongs to the main viewer's model.
        if (models.length === 1) {
            console.error('Issue seedUrn does not exist. Assume pushpin belongs to viewer current main model');
            return models[0];
        } else {
            console.error('Issue seedUrn does not exist.');
            return null;
        }
    }
    // Extract decoded lineage urn from seedUrn
    // We ignore the version part, so that the visible model is also found if it is another model version.
    // Note: If the model is outside the version range of the issue, it will
    //		   not be displayed anyway, so that we don't have to check the version here again.
    const issueLineageId = getLineageId(seedUrn);

    // Find model with matching lineageId
    for (let i=0; i<models.length; i++) {

        // get lineageId of next model
        const model     = models[i];
        const urn       = model.myData.urn;
        const lineageId = getLineageId(urn);

        // return model if matching
        if (lineageId === issueLineageId) {
            return model;
        }
    }

    if (models.length === 1) {
        //console.error('Issue seedUrn does not match with any visible model urn. Assume pushpin belongs to viewer current main model');
        return models[0];
    }

    // We didn't find any model that matches the given issue. This should not happen, because 
    // issues are not supposed to be displayed if it doesn't belong to any visible model. 
    // TODO: Investigate whether the assumption above might be temporarily broken due to async calls. E.g., if a model
    //       was toggled off shortly before the issue was received.
    //console.error('Issue seedUrn does not match with any visible model urn.');
};

// Unique id for runtime-generated PushPinItems. Note that the id will be overwritten by actual GUIDs if issues are saved or loaded.
// Note: It would be cleaner to consistently use guids in the first place. But, this requires some refactoring first to get rid
//       of a hack in RenderHandler.createRenderItem (https://git.autodesk.com/fluent/lmv.js/blob/develop/extensions/Pushpins/PushPins3D/RenderHandler3D.js#L188),
//       which uses the ID length to distinguish between loaded and newly created issues.
let _nextPushPinId = 1;

export default class PushPinItem {
    constructor() {
        this.itemData = {
            id: (_nextPushPinId++).toString(),
            label: 'New',
            status: 'issues-open',
            position: { x: 0, y: 0, z: 0 },
            type: 'issues',
            objectId: null,
            externalId: null,
            viewerState: null,
            objectData: null,
            locationIds: [],
            seedURN: null,
        };

        // Params affect render or interaction
        this.selected = false;
        this.isVisible = true;
        this.draggable = false;
        this.selectable = true;
    }

    get data() {
        return this.itemData;
    }

    get visible() {
        return this.isVisible;
    }

    set visible(isVisible) {
        if (!this.hasPosition()) {
            this.isVisible = false;
        } else {
            this.isVisible = isVisible;
        }
    }

    defaultAppearance() {
        const normalSize = 40;
        const selectedSize = 60;

        return {
            normalSize,
            selectedSize,
            draggableStatus: '-movable',
            selectedStatus: '-selected'
        };
    }

    set(data) {
        this.itemData = Object.assign({}, this.itemData, data);
        this.correctDataFormat();

        return this;
    }

    // Like set, but performs a conversion of position and viewerState from model-local-coords to viewer-coords.
    // PushPinItems store viewer coordinates, i.e., ready-to-render for the current viewer. Expected input is 
    // in model-local coordinates, i.e., excluding any load-time transforms.
    //
    // Note that the model of the Pushpin must be visible/loaded.
    setLocal(data, viewer) {

        this.set(data);

        // Positions are specified relative to the model the issue belongs to. We have to find this model first.
        const model = this.findModel(viewer);
        if (!model) {
            // If we ever see this message, we are trying to create an issue for a model that is not shown.
            // If this actually happens, we need some additional fallback logic here, e.g.
            // set position to undefined first and update on model-show events.
            console.error('PushPin coordinate conversion failed: PushPin must belong to a visible model.');
            return;
        }

        // Why creating a new vector here instead of converting in-place:
        //  - this.itemData is only a shallow copy and we don't want to modify the src input data
        //  - Original vectors cannot be assumed to be THREE types.
        this.itemData.position = new THREE.Vector3().copy(this.itemData.position);

        // Apply matrix that combines all transforms that have been applied to the model during loading.
        // Note that modelTf may be undefined. This is no error, but just indicates that neither placement nor offset was applied to the model.
        const modelTf = model.myData.placementWithOffset;
        if (modelTf) {
            this.itemData.position.applyMatrix4(modelTf);
        }

        // Apply this transforms to position. 
        
        // Replace viewerState by transformed copy
        // Note that we cannot use placementWithOffset here as we did for position. To make it more confusing,
        // there is another legacy constraint: viewerState values are currently stored in world-coords, i.e., viewer-coords with added 
        // global offset. The current globalOffset is subtracted when applying the viewerState (see PushPinViewerState.js:restoreViewState).
        // 
        // It would be easier and more consistent to store viewerState in viewer-coords as well. But this would currently break legacy code,
        // e.g., older issue-UI versions that don't use createItemFromLocal() are working based on the assumption that viewerStates are in world-coords.
        const placementTf = model.myData.placementTransform;
        this.itemData.viewerState = JSON.parse(JSON.stringify(this.itemData.viewerState));

        // Transform viewer state. Note that placementTf may be undefined if the model was loaded without any placement transform.
        // This is okay and just means that we can skip the transform step.
        if (placementTf) {
            transformViewerState(this.itemData.viewerState, placementTf);
        }
    }

    // Returns a copy of the PushPin itemData where position and viewerState are provided in model-local coords.
    // The model that the issue is assigned to must be visible.
    getLocal(viewer) {

        // Find the model for which the issue was assigned
        const model = this.findModel(viewer);
        if (!model) {
//            console.error('PushPin coordinate conversion failed: PushPin must belong to a visible model.');
            return;
        }

        let localData = Object.assign({}, this.itemData);

        // Create copies of position and viewerState, so that they can be safely transformed and passed outside.
        localData.position = new THREE.Vector3().copy(this.itemData.position);
        localData.viewerState = JSON.parse(JSON.stringify(this.itemData.viewerState));

        // Get matrices to convert between different coordinate spaces. 
        // Note that both matrices may be undefined. This is no error and just indicates that the two coordinate
        // spaces are the same. 
        const modelLocalToViewer = model.myData.placementWithOffset;
        const modelLocalToWorld   = model.myData.placementTransform;

        // Convert position from viewer coords to model-local coords.
        if (modelLocalToViewer) {
            const viewerToModelLocal = modelLocalToViewer.clone().invert();
            localData.position.applyMatrix4(viewerToModelLocal);
        }

        // Convert viewerState from world-coords to model-local coords.
        if (modelLocalToWorld) {
            // Create copy of the viewerState that is transformed from world-coords to model-local coords.
            const worldToModelLocal  = modelLocalToWorld.clone().invert();
            transformViewerState(localData.viewerState, worldToModelLocal);
        }

        return localData;
    }

    setObjectId(dbId) {
        this.itemData.objectId = dbId;
    }

    setObjectData(res) {
        const model = res.model;
        if (!model) {
            return;
        }
        const data = model.getData();
        if (!data) {
            return;
        }
        const documentNode = model.getDocumentNode();
        if (!documentNode) {
            return;
        }
        const docNodeData = documentNode.data;
        if (!docNodeData) {
            return;
        }
        this.itemData.objectData = {
            guid: docNodeData.guid,
            urn: data.urn,
            viewableId: docNodeData.viewableID,
            viewName: docNodeData.name
        };
    }

    setExternalId(externalId) {
        this.itemData.externalId = externalId;
    }

    setPosition(newPos) {
        this.itemData.position = Object.assign({}, newPos);
    }
    
    hasPosition() {
        return this.itemData.position.x !== null && this.itemData.position.y !== null && this.itemData.position.z !== null;
    }

    // Finds the visible model whose lineageId matches the seedUrn stored for this issue.
    // May return undefined if the model is currently not visible.
    findModel(viewer) {
        // if viewerState doesn't exist, the only way to not "give up" on the pushpin, is to check if the viewer has only a single model.
        const visibleModels = viewer.getVisibleModels();
        if (!this.itemData.viewerState && visibleModels.length === 1) {
            return visibleModels[0];
        }

        const seedUrn = this.getSeedUrn();
        return findMatchingModel(viewer, seedUrn);
    }

    setViewerState(state) {
        this.itemData.viewerState = Object.assign({}, state);

        // Added attributesVersion to viewerState until all the BIM clients will save it in the backend.
        this.itemData.viewerState.attributesVersion = ATTRIBUTES_VERSION;
    }

    setOriginalDocumentResolution(originalDocumentResolution) {
        this.setViewerState({ originalDocumentResolution });
    }

    correctDataFormat() {
        const defaultStatusNames = [
            'draft', 'draft-selected', 'draft-movable', 'open', 'open-selected',
            'open-movable', 'answered', 'answered-selected', 'answered-movable',
            'closed', 'closed-selected', 'closed-movable'
        ];

        defaultStatusNames.forEach((status) => {
            if (this.itemData.status === status) {
                this.itemData.status = `${this.itemData.type || 'issues'}-${this.itemData.status}`;
            }
        });
    }

    getAttributesVersion() {
        // get attributesVersion from viewerState until all the BIM clients will save it in the backend.
        return this.itemData.attributesVersion || (this.itemData.viewerState && this.itemData.viewerState.attributesVersion);
    }

    setLocationIds(locationIds) {
        this.itemData.locationIds = locationIds;
    }

    getSeedUrn() {
        // TODO: Find out why for serialized issues, it is called "seedUrn" while for newly created PushPins it is called "seedURN". In LMV viewer states, it was 
        //       always "seedURN" since several years.
        return this.itemData.seedURN || this.itemData.viewerState?.seedUrn || this.itemData.viewerState?.seedURN;
    }

    setSeedUrn(seedUrn) {
        this.itemData.seedURN = seedUrn;
    }
}

namespace.PushPinItem = PushPinItem;
