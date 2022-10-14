const applyOffsetToCamera = (viewport, offset) => {
    if (!viewport || !offset) {
        return;
    }

    if ('eye' in viewport) {
        viewport.eye[0] = (Number(viewport.eye[0]) + offset.x).toString();
        viewport.eye[1] = (Number(viewport.eye[1]) + offset.y).toString();
        viewport.eye[2] = (Number(viewport.eye[2]) + offset.z).toString();
    }

    if ('target' in viewport) {
        viewport.target[0] = (Number(viewport.target[0]) + offset.x).toString();
        viewport.target[1] = (Number(viewport.target[1]) + offset.y).toString();
        viewport.target[2] = (Number(viewport.target[2]) + offset.z).toString();
    }

    if ('pivotPoint' in viewport) {
        viewport.pivotPoint[0] = (Number(viewport.pivotPoint[0]) + offset.x).toString();
        viewport.pivotPoint[1] = (Number(viewport.pivotPoint[1]) + offset.y).toString();
        viewport.pivotPoint[2] = (Number(viewport.pivotPoint[2]) + offset.z).toString();
    }
};

const applyOffsetToCutplanes = (cutplanes, offset) => {
    if (!cutplanes || !offset) {
        return;
    }

    const normal = new THREE.Vector3();

    for (let i = 0; i < cutplanes.length; i++) {
        const cutplane = cutplanes[i];
        // A cutplane is an array of 4 numbers. The first 3 numbers represent the plane's normal vector
        // and the 4th number is the distance along it
        toVector(cutplane, normal);
        // Translating a plane by an offset vector is equivalent to adding dot(n,of) where n is the plane normal
        // This again is equivalent to adding or subtracting dot(n, of) to the constant of the plane
        // We have plane.constant = -plane.normal.dot(onPlane + globalOffset)
        //                        = -plane.normal.dot(onPlane) - plane.normal.dot(globalOffset)
        //                        = oldConstant - plane.normal.dot(globalOffset)
        cutplane[3] = Number(cutplane[3]) - normal.dot(offset);
    }
};

const amendViewportIfNeeded = (viewer, item) => {
    const globalOffset = viewer.model ? viewer.model.getData().globalOffset : null;
    const state = JSON.parse(JSON.stringify(item.data.viewerState));

    if (globalOffset) {
        const invGlobalOffset = { x: -globalOffset.x, y: -globalOffset.y, z: -globalOffset.z };

        applyOffsetToCamera(state.viewport, invGlobalOffset);

        if (item.getAttributesVersion() >= 2) {
            applyOffsetToCutplanes(state.cutplanes, invGlobalOffset);
        }
    }

    const model = item.findModel(viewer);
    const modelTransform = model?.getModelTransform();

    if (modelTransform) {
        transformViewerState(state, modelTransform);
    }

    //Support legacy edge cases where Viewer state doesn't contain objectState;
    if (!state.objectSet) {
        state.objectSet = [];
    }

    return state;
};

export const generateMetadata = (viewer, item) => {
    const globalOffset = viewer.model ? viewer.model.getData().globalOffset : null;
    const viewerState = viewer.getState();
    const state = JSON.parse(JSON.stringify(viewerState));

    // Replace viewerState's seedURN with a specific model's seedURN.
    // It's needed because viewer.getState() returns always the first model's seedUrn - and not really the relevant model's urn.
    state.seedURN = item.getSeedUrn() || viewerState.seedURN;
    
    if (globalOffset) {
        applyOffsetToCamera(state.viewport, globalOffset);
        applyOffsetToCutplanes(state.cutplanes, globalOffset);

        state.globalOffset = globalOffset;
    }

    const model = item.findModel(viewer);
    const modelTransform = model?.getModelTransform();

    if (modelTransform) {
        transformViewerState(state, modelTransform.clone().invert());
    }

    return state;
};

export const restoreViewState = (viewer, item, immediate) => {
    if (item.data && item.data.viewerState) {
        const amendedData = amendViewportIfNeeded(viewer, item);
        const visibleModels = viewer.getVisibleModels();

        // While restoring Viewer state, check if any of isolated items exist in scene
        // Remove non-existing dbIds from objectSet inside of Pushpin's viewer state (BLMV-4397)
        for (let i = 0; i < visibleModels.length; i++) {
            const seedUrn = visibleModels[i].getSeedUrn();
            const onlySingleModel = visibleModels.length === 1;

            // Condition that checks if dbId exists before isolating
            const itemExist = (isolatedItem) => visibleModels[i].isNodeExists(isolatedItem);

            for (let j = 0; j < amendedData.objectSet.length; j++) {
                // Since Viewer state with single model has no seedUrn within objectSet,
                // need to check indpendently states with single and multiple models in Viewer state
                const isSingle = (!amendedData.objectSet[j].seedUrn && onlySingleModel);
                if (isSingle || amendedData.objectSet[j].seedUrn === seedUrn || amendedData.seedURN === seedUrn) {
                    const isolatedItems = amendedData.objectSet[j].isolated;
                    for (let k = 0; k < isolatedItems.length; k++) {
                        if (!visibleModels[i].isNodeExists(isolatedItems[k])) {
                            amendedData.objectSet[j].isolated.splice(k, 1);
                            k--;
                        }
                    }
                }
            }
        }


        viewer.restoreState(amendedData, null, immediate);

        // RestoreState will async to update camera's all data. Here force update camera before load pushpin.
        const navapi = viewer.navigation;

        if (navapi) {
            navapi.updateCamera();
            const camera = navapi.getCamera();

            camera.updateMatrixWorld();
        }
    }
};

// Convert from array of values (or number-strings) to THREE.Vector.
// Like THREE.Vector3.fromArray(), but with string->number conversion, because some viewerState values are stored as strings.
const toVector = (src, dst) => {
    dst.x = Number(src[0]);
    dst.y = Number(src[1]);
    dst.z = Number(src[2]);
};

// Transforms a point given as array-3 by a THREE.Matrix4
const transformPoint = function() {
    const v = new THREE.Vector3();

    return (values, tf) => {
        toVector(values, v);
        v.applyMatrix4(tf);
        v.toArray(values);
    };
}();

// Transforms a direction vector given as array-3 by a THREE.Matrix4
const transformNormal = function() {
    const v = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();

    return (values, tf) => {
        toVector(values, v);

        normalMatrix.getNormalMatrix(tf);
        v.applyMatrix3(normalMatrix);
        v.normalize(); // Re-normalize, so that scaling doesn't kill normalized directions.

        v.toArray(values);
    };
}();

// Transforms orthographic height by using transformed vector distances.
// Orthographic height may be different from eye/target distance, so we calculate it separately
// and let the viewerImpl work out which one to use.
// It is necessary to use this approach because the transform matrix could contain transformations
// which a naive scalar multiplication wouldn't handle correctly.
const transformOrthographicHeight = function() {
    const eye = new THREE.Vector3();
    const target = new THREE.Vector3();
    const orthographicHeightVector    = new THREE.Vector3();

    return (viewport, tf) => {
        // Convert to THREE.Vectors that we can calculate with as they may be provided as arrays.
        toVector(viewport.eye, eye);
        toVector(viewport.target, target);

        // Compute a view-direction vector that is scaled to match orthographicHeight
        orthographicHeightVector.subVectors(eye, target).normalize().multiplyScalar(viewport.orthographicHeight);

        // Compute new eye vector with distance from target equal to orthographicHeight
        eye.copy(target).add(orthographicHeightVector);

        // Transform adjusted eye vector and target by the provided model transform.
        eye.applyMatrix4(tf);
        target.applyMatrix4(tf);

        // Derive transformed length by getting the distance between the adjusted eye and the target after transform.
        viewport.orthographicHeight = eye.distanceTo(target);
    };
}();

export const transformViewerState = (state, tf) => {
    if (!state || !tf) {
        return;
    }

    // If we are in orthographic mode and have a real orthographicHeight we need to calculate
    // a new orthographicHeight using the provided transform.
    if (state.viewport.isOrthographic && state.viewport.orthographicHeight > 0) {
        transformOrthographicHeight(state.viewport, tf);
    }

    // Note that these values are not vectors, but arrays (in some cases even containing string-type-values).
    transformPoint(state.viewport.eye, tf);
    transformPoint(state.viewport.target, tf);
    transformPoint(state.viewport.pivotPoint, tf);

    transformNormal(state.viewport.up, tf); // may become relevant if tf contains a true-north rotation and the camera-up is not vertical
    transformNormal(state.viewport.worldUpVector, tf);

    if (state.cutplanes) {
        const plane = new THREE.Plane();
        const normal = new THREE.Vector3();

        for (let i = 0; i < state.cutplanes.length; i++) {
            const cutplane = state.cutplanes[i];

            toVector(cutplane, normal);
            const constant = Number(cutplane[3]);
            plane.set(normal, constant);

            plane.applyMatrix4(tf);

            plane.normal.toArray(cutplane);
            cutplane[3] = plane.constant;
        }
    }
};
