// Compute the max level from leaflet max resolution texture.
function computeMaxLevel(w, h) {
    // compute maxLevel that we would get for 1x1 resolution at level 0
    const lx = Math.ceil(Math.log2(w));
    const ly = Math.ceil(Math.log2(h));
    const maxLevel = Math.max(lx, ly);

    // since the actual root tile has tileSize x tileSize, we subtract the skipped levels.
    return maxLevel;
}

export function clientToWorldLeaflet(viewer, x, y) {
    let loadOptions;
    let bounds;

    if (viewer.model.isPdf(true)) {
        loadOptions = Autodesk.Viewing.PDFUtils.getLeafletLoadOptions(viewer);
        bounds = Autodesk.Viewing.PDFUtils.getLeafletBoundingBox(viewer);
    } else {
        const modelData = viewer.model.getData();
        loadOptions = modelData.loadOptions.loadOptions;
        bounds = modelData.bbox;
    }

    const { texWidth, texHeight } = loadOptions;

    const worldPos = viewer.clientToWorld(x, y, undefined, true).point;
    const worldTopLeft = new THREE.Vector3(bounds.min.x, bounds.max.y, 0);

    worldPos.sub(worldTopLeft);
    const boundsSize = bounds.getSize(new THREE.Vector3());
    const newX = (worldPos.x * texWidth) / boundsSize.x;
    const newY = (worldPos.y * texHeight) / boundsSize.y;

    const point = new THREE.Vector3(newX, newY, 0);

    const maxLevel = computeMaxLevel(texWidth, texHeight);
    const scale = Math.pow(2, maxLevel);

    const px = point.x / scale;
    const py = point.y / scale;

    // x & y are swapped for some reason. Can't change it now for backward compatibility.
    return new THREE.Vector3(py, px, 0);
}

export function clientToWorld(viewer, x, y) {
    if (viewer.model.isLeaflet()) {
        return clientToWorldLeaflet(viewer, x, y);
    } else {
        return viewer.clientToWorld(x, y, undefined, true).point;
    }
}

export function applyPdfWorldScaling(viewer, itemData) {
    if (viewer.model.isLeaflet() || viewer.model.isPdf(true)) {
        const originalDocumentResolution = itemData.viewerState && itemData.viewerState.originalDocumentResolution;

        // In case of leaflet - it changes to world coordinates.
        const clientPos = worldToClient(viewer, itemData.position, originalDocumentResolution);
        const worldPos = viewer.clientToWorld(clientPos.x, clientPos.y, undefined, true).point;
        return worldPos;
    } else {
        return itemData.position;
    }
}

export function worldToClient(viewer, point, originalDocumentResolution) {
    if (!viewer.model.isLeaflet() && !viewer.model.isPdf(true)) {
        return viewer.worldToClient(point);
    }

    let x = point.y;
    let y = point.x;

    let loadOptions;
    let bounds;

    if (viewer.model.isPdf(true)) {
        loadOptions = Autodesk.Viewing.PDFUtils.getLeafletLoadOptions(viewer);
        bounds = Autodesk.Viewing.PDFUtils.getLeafletBoundingBox(viewer);
    } else {
        const modelData = viewer.model.getData();
        loadOptions = modelData.loadOptions.loadOptions;
        bounds = modelData.bbox;
    }

    const { texWidth, texHeight } = loadOptions;

    const maxLevel = computeMaxLevel(texWidth, texHeight);
    const scale = Math.pow(2, maxLevel);
    x *= scale;
    y *= scale;

    // https://jira.autodesk.com/browse/BLMV-2853
    // In case that the DPI of the current document is different than the DPI of the document where the pushpin has originally created (or edited)
    // We need to scale the ratio back in order that the pushpin will appear in the same place.
    const originalDocumentWidth = (originalDocumentResolution && originalDocumentResolution[0]) || texWidth;
    const dpiCorrection = texWidth / originalDocumentWidth;

    const boundsSize = bounds.getSize(new THREE.Vector3());
    const wx = (x / (texWidth / dpiCorrection)) * boundsSize.x;
    const wy = (y / (texHeight / dpiCorrection)) * boundsSize.y;

    const worldPos = new THREE.Vector3(bounds.min.x + wx, bounds.max.y + wy, 0);

    if (viewer.model.isPdf(true)) {
        Autodesk.Viewing.PDFUtils.leafletToPdfWorld(viewer, worldPos);
    }

    return viewer.impl.worldToClient(worldPos);
}

// Used for saving pushpins in the backend like they were created in Leaflet, instead of PDF.
export function convertPdfToLeaflet (viewer, itemData) {
    const p = Autodesk.Viewing.PDFUtils.pdfToLeafletWorld(viewer, new THREE.Vector3().copy(itemData.position));
    if (!p) {
        return;
    }
    
    itemData.position = { x: p.y - 1, y: p.x, z: 0 }; // x & y are swapped for some reason. Can't change it now for backward compatibility.
}

export function applyModelTransform (point, model) {
    const modelTransform = model?.getModelTransform();

    if (modelTransform) {
        point.applyMatrix4(modelTransform);
    }
}

export function invertModelTransform (point, model) {
    const modelTransform = model?.getModelTransform();

    if (modelTransform) {
        point.applyMatrix4(modelTransform.clone().invert());
    }
}
