import Level from './Level';

function getProjectElevation(level) {
    let ext = level.extension;

    if (ext && Object.prototype.hasOwnProperty.call(ext, 'projectElevation'))
        return ext.projectElevation;

    return level.elevation;
}

export function transformLevelsByMatrix(levels, refPointTransformation) {

    let v = new THREE.Vector3();
    const transformByMatrix = (value) => {
        v.set(0,0,value);
        v.applyMatrix4(refPointTransformation);
        return v.z;
    };

    levels.forEach(currentLevel => {
        currentLevel.zMin = transformByMatrix(currentLevel.zMin);
        currentLevel.zMax = transformByMatrix(currentLevel.zMax);
    });
}


// transform is given as 12 floats
export function transformLevels(levels, refPointTransformation) {
    if (!refPointTransformation)
        return;

    // get transform as THREE.Matrix4
    const matrix = Autodesk.Viewing.BubbleNode.readMatrixFromArray12(refPointTransformation);
    transformLevelsByMatrix(levels, matrix);
}

//Explanation from design-collaboration repo:
// Hint: the idea to move the level zMin value an inch down is to make sure that the
// end-user can also see the bottom floor. Otherwise in some cases the floor would just
// be cut-away by the floor selection. This value was defined after experimenting with
// several models and maybe needs adjustment in the future.
export const zOffsetHack = 1 / 12;

export function aecModelDataToLevels(aecModelData, placementTf, modelTransform) {
    // levels are sorted ascending

    // we have to handle the building story flag of a Revit level
    // filter out all Revit levels which do not have building story set to true
    const filteredLevels = aecModelData.levels.filter(l => {
        let ext = l.extension;

        if (!ext)
            return true;

        //So.... if it has no buildingStory property, it's a building story...
        if (!Object.prototype.hasOwnProperty.call(ext, 'buildingStory'))
            return true;

        return ext.buildingStory;
    });

    let levels = [];

    const count = filteredLevels.length;
    filteredLevels.forEach( (currentLevel, index) => {

        let nextElevation = undefined;
        if (index + 1 < count) {
            nextElevation = getProjectElevation(filteredLevels[index + 1]);
        }
        else {
            // for the topmost floor, we must use its height to determine the next boundary
            const topLevel          = filteredLevels[filteredLevels.length - 1];
            const topLevelElevation = getProjectElevation(topLevel);
            nextElevation = topLevelElevation + topLevel.height;
        }

        levels.push(
            new Level(
                levels.length,
                currentLevel.guid,
                currentLevel.name,
                getProjectElevation(currentLevel) - zOffsetHack,  // zMin
                nextElevation       // zMax
            )
        );
    });

    // If the model is known, use its attached transform. This variant works with any loadOptions. 
    if (placementTf) {
        transformLevelsByMatrix(levels, placementTf);
    } else {
        // If the model is not known, we assume that no zOffset is applied. This is only
        // true when using applyRefPoint=true and a gobalOffset with z=0.
        transformLevels(levels, aecModelData.refPointTransformation);
    }

    if (modelTransform) {
        transformLevelsByMatrix(levels, modelTransform);
    }

    return levels;
}

export function chooseMainModel(viewer, ignoreAecModelData) {
    
    let models = viewer.impl.modelQueue().getModels();
    let mainModel = null;
    let mainModelSize = -1;
    models.forEach(model => {
        
        if (model.is2d())
            return;

        let bubbleNode = model.getDocumentNode();

        if (!bubbleNode)
            return;

        if (!ignoreAecModelData) {
            let aecModelData = bubbleNode.getAecModelData();

            if (!aecModelData)
                return;
        }

        if (bubbleNode.data.size > mainModelSize) {
            mainModel = model;
            mainModelSize = bubbleNode.data.size;
        } else if(!bubbleNode.data.size && mainModelSize === -1) {
            mainModel = model;
            mainModelSize = 0;
        }
    });
    return mainModel;
}

export function modelDataOccluders(viewer) {

    let models = viewer.impl.modelQueue().getModels();

    let occludersPerModel = new Map();
 
    models.forEach(model => {

        if (model.is2d())
            return;

        let bubbleNode = model.getDocumentNode();
        if (!bubbleNode)
            return;
        let aecModelData = bubbleNode.getAecModelData();
        if (!aecModelData)
            return;

        occludersPerModel.set(model.id, aecModelData.levelOccluderIds);
    });

    return { modelsDbIds: occludersPerModel };
}
