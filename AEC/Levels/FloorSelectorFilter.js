'use strict';

const namespace = AutodeskNamespace('Autodesk.AEC');

// The FloorSelectorFilter provides functionality to additionally apply object filtering
// by dbIds on level selection.
//

export default class FloorSelectorFilter {

    // @param {Viewer3D} viewer
    constructor(viewer) {
        this._viewer = viewer;
        // Contains all dbIds per model used to un-hide the objects whenever another level gets selected.
        this._dbIdsToUnhide = new Map();
        this._cache = {};
    }

    // Filter all elements by dbIds on level selection.
    //  @param {Object}   floorFilterData   - A floor filter data object containing all dbIds per model and an optional level height factor.
    //  @param {Object}   floor             - A floor.
    filter(floorFilterData, floor) {
        if (!floorFilterData) {
            throw new Error('floorFilterData cannot be undefined.');
        }
        if (!(floorFilterData.modelsDbIds instanceof Map)) {
            throw new Error('floorFilterData.modelsDbIds has to be a Map.');
        }
        if (!floor) {
            throw new Error('floor cannot be undefined.');
        }

        // Get the level height factor and also do some basic number checks.
        const levelHeightFactor = this._getLevelHeightFactor(floorFilterData.levelHeightFactor);

        // All Floor and Ceiling db ids per model to hide.
        let modelsDbIds = floorFilterData.modelsDbIds;

        // Do nothing in case no db ids are set.
        if (!this._hasModelDbIds(modelsDbIds)) {
            return;
        }

        const minZ = floor.zMin;
        const maxZ = floor.zMax;

        // Calculate the new minZ/maxZ values of the level boundary used to spatially filter the Floor and
        // Ceiling elements.
        // 1. The lower boundary value (zMin) is moved up by the factor of the level height, because the Ceiling
        //    elements we want to filter are located in the upper part of the level.
        // 2. The upper boundary value (zMax) is moved up by 10% of the level height, because in some models
        //    this helps to also remove floors which would be still shown otherwise.
        const newMinZ = minZ + ((maxZ - minZ) * levelHeightFactor);
        const newMaxZ = maxZ + ((maxZ - minZ) * 0.1);

        // Setup cache for each floor.
        if (!this._cache[floor.name]) {
            this._cache[floor.name] = {};
        }

        const modelQueue = this._viewer.impl.modelQueue();
        const models = modelQueue.getModels();

        for (let m = 0, l = models.length; m < l; m++) {
            const model = models[m];

            if (!model.visibilityManager) {
                console.warn(`The VisibilityManager of the model with ID = ${model.id} is not yet initialized.`);
                break;
            }

            // Try to get the db ids for a specific level and model from the cache.
            if (this._cache[floor.name][model.id]) {
                const cachedDbIds = this._cache[floor.name][model.id];
                if (cachedDbIds.size > 0) {
                    this.hideDbIds(model, cachedDbIds);
                }
                continue;
            }

            const instanceTree = model.getInstanceTree();
            if (!instanceTree) {
                console.warn(`The instanceTree of the model with ID = ${model.id} is not yet initialized.`);
                continue;
            }

            let dbIdsToHide = new Set();
            const dbIds = modelsDbIds.get(model.id);
            if (!dbIds) {
                continue;
            }

            dbIds.forEach(dbId => {
                let nodeBox = new Float32Array(6);
                instanceTree.getNodeBox(dbId, nodeBox);

                const nodeBoxMinZ = nodeBox[2];
                const nodeBoxMaxZ = nodeBox[5];

                if ((nodeBoxMinZ >= newMinZ && nodeBoxMinZ <= newMaxZ) ||
                    (nodeBoxMaxZ >= newMinZ && nodeBoxMaxZ <= newMaxZ) ||
                    (nodeBoxMinZ <= newMinZ && nodeBoxMaxZ >= newMaxZ)) {
                    dbIdsToHide.add(dbId);
                }
            });

            if (dbIdsToHide.size > 0) {
                this.hideDbIds(model, dbIdsToHide);
            }

            this._cache[floor.name][model.id] = dbIdsToHide;
        }
    }

    hideDbIds(model, dbIds) {
        if (!model.visibilityManager) {
            return;
        }

        dbIds.forEach(id => {
            model.visibilityManager.setNodeOff(id, true);
        });

        // Collect all dbIds per model, so we can un-hide them later on again.
        if (this._dbIdsToUnhide.has(model)) {
            const dbIds = this._dbIdsToUnhide.get(model);
            for (let dbId of dbIds) {
                dbIds.add(dbId);
            }
        } else {
            this._dbIdsToUnhide.set(model, dbIds);
        }
    }

    // Un-hides all objects (using the dbId) per model.
    clearFilter() {
        if (this._dbIdsToUnhide.size === 0) {
            return;
        }

        this._dbIdsToUnhide.forEach(function(dbIds, model) {
            // Handles the case when the model is not visible and the level isolation is deactivated.
            if (!model.visibilityManager) {
                return;
            }

            dbIds.forEach(id => {
                model.visibilityManager.setNodeOff(id, false);
            });

            // Only remove the model dbIds if they are successfully set to visible.
            this._dbIdsToUnhide.delete(model);
        }.bind(this));
    }

    // Un-hides only one model. It's all we can do, as the model.visibilityManager is null,
    // that is we can not call setNodeOff function again
    unhideModel(model) {
        this._dbIdsToUnhide.delete(model);
    }

    _hasModelDbIds(modelsDbIds) {

        if (modelsDbIds.size === 0) {
            return false;
        }

        for (let dbIds of modelsDbIds.values()) {
            if (dbIds && dbIds.length > 0) {
                return true;
            }
        }

        return false;
    }

    _getLevelHeightFactor(levelHeightFactor) {
        if (levelHeightFactor === undefined) {
            // Return default factor.
            return 0.5;
        }

        if (typeof(levelHeightFactor) !== 'number') {
            throw new Error('floorFilterData.levelHeightFactor has to be a number');
        }
        if ((levelHeightFactor < 0 || levelHeightFactor >= 1)) {
            throw new Error('floorFilterData.levelHeightFactor has to be a number between 0-1.');
        }

        return levelHeightFactor;
    }
    
    // Hides all dbIds in a model that are currently expected to be hidden. 
    reApplyFilter(model) {
        const dbIds  = this._dbIdsToUnhide.get(model);
        const visMan = model.visibilityManager;
        if (!dbIds || !visMan) {
            return;
        }
        
        dbIds.forEach(id => { 
            visMan.setNodeOff(id, true);
        });
    }
    
    isVisible(model, dbId) {
        const dbIds  = this._dbIdsToUnhide.get(model);
        return !dbIds || !dbIds.has(dbId);
    }
}

namespace.FloorSelectorFilter = FloorSelectorFilter;
