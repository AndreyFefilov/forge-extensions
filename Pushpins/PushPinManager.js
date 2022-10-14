import PushPinItem from './PushPinItem';
import { PUSHPIN_EVENTS } from './PushPinEvents';
import { convertPdfToLeaflet, applyPdfWorldScaling, clientToWorldLeaflet } from './PushPinUtils';
import { thumbnailSize, thumbnailOriginalPixelSize, thumbnailMarkerRadius } from './PushPinConstants';

const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');

export default class PushPinManager extends Autodesk.Viewing.EventDispatcher {
    constructor(viewer, options = {}) {
        super();

        this.viewer = viewer;
        this.options = options;

        this.pushPinList = [];
        this.selectedItem = null;
        this.PushPinTypes = {
            ISSUES: 'issues',
            RFIS: 'rfis',
            QUALITY_ISSUES: 'quality_issues'
        };

        this.is2D = !!this.viewer.impl.is2d;

        // In case the 3d model has no thickness, consider it as a 'pseudo 2D' model.
        // It will disable the occlusion test. And when creating new pushpins it will not interact with the objects, but with the ground. 
        if (!this.is2D) {
            const modelBB = this.viewer.model.getBoundingBox();
            const worldUp = this.viewer.impl.worldUpName();
            this.isPseudo2D = modelBB.max[worldUp] - modelBB.min[worldUp] === 0;
            this.options.disableOcclusionTest = this.options.disableOcclusionTest || this.isPseudo2D;
        }

        this.pushPinsVisibilityByType = this.getInitialPushpinVisibilityByType();
        this.pushpinsByType = this.getInitialPushpinsByType();
        this.create = Promise.resolve();

        this.onPushpinEditStartBinded = this.onPushpinEditStart.bind(this);
        this.onPushpinEditEndBinded = this.onPushpinEditEnd.bind(this);

        this.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_EDIT_START_EVENT, this.onPushpinEditStartBinded);
        this.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_EDIT_END_EVENT, this.onPushpinEditEndBinded);
        this.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVED_EVENT, this.onPushpinEditEndBinded);
    }

    items() {
        return this.pushPinList;
    }

    getInitialPushpinsByType() {
        const cache = {};

        Object.keys(this.PushPinTypes).forEach((issueTypeKey) => {
            cache[this.PushPinTypes[issueTypeKey]] = {};
        });

        return cache;
    }

    getInitialPushpinVisibilityByType() {
        const cache = {};

        Object.keys(this.PushPinTypes).forEach((typeKey) => {
            cache[this.PushPinTypes[typeKey]] = true;
        });

        return cache;
    }

    shouldGenerateThumbnail(item) {
        return (this.options.generateIssueThumbnail && (item.data.type === this.PushPinTypes.ISSUES || item.data.type === this.PushPinTypes.QUALITY_ISSUES)) ||
                (this.options.generateRFIThumbnail && item.data.type === this.PushPinTypes.RFIS);
    }

    generateThumbnail(item) {
        if (!this.shouldGenerateThumbnail(item)) {
            return Promise.resolve(null);
        }

        return new Promise((resolve, reject) => {
            const { x, y, z } = item.data.position; // Backup position.

            if (this.viewer.model.isPdf(true)) {
                convertPdfToLeaflet(this.viewer, item.data);
            }

            this.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_PREPARING_THUMBNAIL, value: item });

            item.data.position = { x, y, z }; // Restore position.

            let width, height, zoomRatio;
            let pWorld;
            let markerPos;
            let bounds;

            if (this.viewer.model.isLeaflet()) {
                pWorld = applyPdfWorldScaling(this.viewer, item.data);
            } else {
                pWorld = item.data.position;
            }

            const canvasBounds = this.viewer.impl.getCanvasBoundingClientRect();
            const ratio = canvasBounds.width / canvasBounds.height;

            if (ratio > 1) {
                height = Math.floor(Math.max(canvasBounds.height, thumbnailSize));
                zoomRatio = (height / canvasBounds.height);
                width = Math.floor(canvasBounds.width * zoomRatio);
            } else {
                width = Math.floor(Math.max(canvasBounds.width, thumbnailSize));
                zoomRatio = (width / canvasBounds.width);
                height = Math.floor(canvasBounds.height * zoomRatio);
            }

            const overlayRenderer = (viewer, options) => {
                const { width, height, ctx, target, screenshotCamera, onRenderDone } = options;
                const { canvas } = ctx.targetToCanvas(target);

                // In case bounds were supplied, it means that the marker should be in the center of the screenshot.
                if (bounds) {
                    markerPos = { x: width / 2, y: height / 2 };
                } else {
                    // Otherwise, we are probably in a 3D scene - marker can be anywhere. In that case we should
                    // calculate the marker position on canvas according to the pushpin's world position.
                    markerPos = viewer.worldToClient(pWorld, screenshotCamera).multiplyScalar(zoomRatio);
                }

                const radius = thumbnailMarkerRadius;
                var ctx2d = canvas.getContext("2d");
                ctx2d.fillStyle = "#FF0000";
                ctx2d.beginPath();
                ctx2d.arc(markerPos.x, height - markerPos.y, radius, 0, 2 * Math.PI);
                ctx2d.closePath();
                ctx2d.fill();

                onRenderDone(canvas);
            };

            const getCropBounds = (viewer, camera) => {
                let cropCenter = markerPos;

                // Make sure crop won't exceed bounds.
                if (cropCenter.x + thumbnailSize / 2 > width) {
                    cropCenter.x -= cropCenter.x + thumbnailSize / 2 - width;
                }

                if (cropCenter.y + thumbnailSize / 2 > height) {
                    cropCenter.y -= cropCenter.y + thumbnailSize / 2 - height;
                }

                const clientBounds = new THREE.Box2().expandByPoint(cropCenter);
                clientBounds.expandByVector(new THREE.Vector2(thumbnailSize / 2, thumbnailSize / 2));

                return clientBounds;
            };

            // Zoom in with virtual camera to get the desired thumbnail size.
            if (this.viewer.model.is2d()) {

                let thumbnailSizeWorld;
                let zeroWorld;

                if (!this.viewer.model.isPageCoordinates()) {
                    thumbnailSizeWorld = clientToWorldLeaflet(this.viewer, thumbnailOriginalPixelSize, 0);
                    zeroWorld = clientToWorldLeaflet(this.viewer, 0, 0);
                } else {
                    thumbnailSizeWorld = this.viewer.clientToWorld(thumbnailOriginalPixelSize, 0, undefined, true).point;
                    zeroWorld = this.viewer.clientToWorld(0, 0, undefined, true).point;
                }

                const size = thumbnailSizeWorld.distanceTo(zeroWorld);

                bounds = new THREE.Box3().expandByPoint(pWorld);
                bounds.expandByVector(new THREE.Vector3(size / 2, size / 2, 0));
                bounds.min.z = 0;
                bounds.max.z = 0;
            }

            const options = {
                bounds,
                getCropBounds,
                overlayRenderer
            };
        
            Autodesk.Viewing.ScreenShot.getScreenShotWithBounds(
                this.viewer,
                width,
                height,
                (blob, outputWidth, outputHeight) => {
                    if (!blob) {
                        return reject('Error while preparing pushpin thumbnail.');
                    }
            
                    Autodesk.Viewing.ScreenShot.blobToImage(blob, outputWidth, outputHeight, (img) => {
                        return resolve(img);
                    });
                },
                options
            );
        }).catch((e) => {
            // In case of an error in the screenshot creation, continue saving the pushpin with empty thumbnail.
            console.error(e);
            return null
        });
    }

    // Update locationIds array inside the item's data.
    setItemLocationIds(item) {
        let point;

        // Locations are stored using page coordinate system.
        // In case we are viewing a Leaflet document, the pushpin position has to be converted into the same coordinate system.
        if (this.viewer.model.isLeaflet()) {
            const pWorld = applyPdfWorldScaling(this.viewer, item.data);

            if (this.viewer.model.isPageCoordinates()) {
                point = pWorld;
            } else {
                point = Autodesk.Viewing.PDFUtils.leafletToPdfWorld(this.viewer, pWorld);
            }
            
        } else {
            point = item.data.position;
        }
        
        // Intersect pushpin position with locations array.
        const intersectedLocationIds = this.getLocationIdsAtPoint(point);
        item.setLocationIds(intersectedLocationIds);
    }

    // @param {Object} data                - Data to be copied to the PushPin. By default, it must contain a pushpin position.
    // @param {bool}   [isTriggeringEvent] - Fire PUSH_PIN_CREATED event by default
    // @param {bool}   [createFromLocal]   - By default, data.position is assumed to be in world-coords (ready-to-render for the viewer).
    //                                       If true, the position is provided in model-local coordinates instead.
    // @param {Viewer3D} [viewer}          - Only needed when createFromLocal is true: In this case, we need to find the model for this PushPin to convert the position.
    createItem(data, isTriggeringEvent = true, createFromLocal = false, viewer = undefined) {

        if (this.getItemById(data.id)) {
            return null;
        }

        const newItem = new PushPinItem();
        
        if (createFromLocal) {
            // Set pushPinData - assuming that position and viewerState are given in model-local coords.
            // In this case, we have to convert them to viewer-coordinates first.
            newItem.setLocal(data, viewer);
        } else {
            newItem.set(data);
        }

        this.addItem(newItem);

        if (isTriggeringEvent) {
            this.create(newItem)
            .then(() => {
                this.setItemLocationIds(newItem);
                return this.generateThumbnail(newItem);
            })
            .then((thumbnail) => {

                const { x, y, z } = newItem.data.position; // Backup position.

                if (this.viewer.model.isPdf(true)) {
                    convertPdfToLeaflet(this.viewer, newItem.data);
                }

                this.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_CREATED_EVENT, value: newItem, thumbnail });

                newItem.data.position = { x, y, z }; // Restore position.
            });
        }

        return newItem;
    }

    addItems(dataArray, createFromLocal, viewer) {
        dataArray.forEach((pushPinData) => {
            if (this.viewer.model.isPdf(true)) {
                const { x, y, z } = applyPdfWorldScaling(this.viewer, pushPinData);
                pushPinData.position = { x, y, z };
            }

            this.createItem(pushPinData, false, createFromLocal, viewer);
        });
    }

    removeAllItems() {
        this.selectedItem = null;
        this.pushPinList = [];

        // Update local pushpins cache
        this.pushpinsByType = this.getInitialPushpinsByType();

        this.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_REMOVE_ALL_EVENT });
    }

    addItem(item) {
        if (item.data && item.data.id) {
            const idx = this.getItemIndexById(item.data.id);

            if (idx > -1) {
                return false;
            }

            let type = item.data.type;

            if (type && this.pushPinsVisibilityByType) {
                item.visible = this.pushPinsVisibilityByType[type];
            }

            type = type || this.PushPinTypes.ISSUES;

            // Update local pushpins cache, handle only pushpins with supported type
            if (this.pushpinsByType[type]) {
                this.pushpinsByType[type][item.data.id] = item.data;
            }

            this.pushPinList.unshift(item);
            return true;
        }
        return false;
    }

    removeItemById(id) {
        if (this.selectedItem && this.selectedItem.data.id === id) {
            this.selectedItem = null;
        }
        const idx = this.getItemIndexById(id);

        if (idx > -1) {
            const item = this.pushPinList.splice(idx, 1)[0];

            const type = item.data.type;

            // Update local pushpins cache, handle only pushpins with supported type
            if (type && this.pushpinsByType[type]) {
                delete this.pushpinsByType[type][id];
            }

            this.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_REMOVED_EVENT, value: item });
            return item;
        }

        return null;
    }

    removeItemsByType(type) {
        const pushPinTypeObject = this.pushpinsByType[type] || {};

        Object.keys(pushPinTypeObject).forEach((id) => {
            this.removeItemById(id);
        });
    }

    updateItemById(id, data) {
        // 1. validate data & create new one
        const item = this.getItemById(id);
        if (!item) {
            return null;
        }
        const idx = this.getItemIndexById(item.data.id);

        if (!data || !data.id || data.type !== item.data.type) {
            return null;
        }

        if (this.viewer.model.isPdf(true)) {
            const { x, y, z } = applyPdfWorldScaling(this.viewer, data);
            data.position = { x, y, z };
        }

        // 2. update data
        item.set(data);

        // 3. update local pushpins cache, handle only pushpins with supported type
        const type = item.data.type;

        if (type && this.pushpinsByType[type]) {
            delete this.pushpinsByType[type][id];
            this.pushpinsByType[type][item.data.id] = item.data;
        }
        this.pushPinList[idx] = item;

        this.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_UPDATE_EVENT, value: item });

        return item;
    }

    getItemById(id) {
        const idx = this.getItemIndexById(id);
        return (idx > -1) ? this.pushPinList[idx] : null;
    }

    getItemIndexById(id) {
        let idx = -1;
        this.pushPinList.every((item, index) => {
            if (item.data.id === id) {
                idx = index;
                return false;
            }
            return true;
        });
        return idx;
    }

    getItemCountByType(type) {
        const pushPinTypeObject = this.pushpinsByType[type] || {};

        return Object.keys(pushPinTypeObject).length;
    }

    getSelectedItem() {
        return this.selectedItem;
    }

    selectOne(id, reTriggerEvent) {
        let triggerSelectionEvent = Boolean(reTriggerEvent);
        if (!this.selectedItem || (this.selectedItem.data.id !== id)) {

            const oldOne = this.selectedItem;
            this.selectedItem = this.getItemById(id);

            if (oldOne !== this.selectedItem) {
                oldOne && (oldOne.selected = false);
                this.selectedItem && (this.selectedItem.selected = true);
                triggerSelectionEvent = true;
            }
        }

        if (triggerSelectionEvent) {
            this.fireEvent({type: PUSHPIN_EVENTS.PUSH_PIN_SELECTED_EVENT, value: this.selectedItem});
        }

        return this.selectedItem;
    }

    selectNone() {
        this.selectOne(null);
    }

    getVisibleByType(type) {
        return this.pushPinsVisibilityByType[type];
    }

    setVisibleByType(type, isVisible) {
        this.pushPinsVisibilityByType[type] = isVisible;
        const pushPinTypeObject = this.pushpinsByType[type] || {};

        Object.keys(pushPinTypeObject).forEach((id) => {
            const item = this.getItemById(id);

            if (item) {
                item.visible = isVisible;
            }
        });

        this.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_VISIBILITY_EVENT, value: { type, isVisible } });
    }

    addEventListener(event, func) {
        if (!this.hasEventListener(event, func)) {
            super.addEventListener(event, func);
        }
    }

    setCreateFunction(func) {
        this.create = func;
    }

    removeCreateFunction(func) {
        if (func === this.create) {
            this.create = Promise.resolve();
        }
    }

    getLocationsExtension() {
        return this.viewer.getExtension("Autodesk.AEC.LocationsExtension");
    }

    getLocationsExtensionAsync() {
        return this.viewer.getExtensionAsync("Autodesk.AEC.LocationsExtension");
    }

    async onPushpinEditStart() {
        const explodeExt = this.viewer.getExtension('Autodesk.Explode');

        if (explodeExt) {
            explodeExt.setUIEnabled(false);
        }

        // In order to avoid extension loading timing issues, we use the async api here.
        // Just make sure that the model wasn't changed by the time we got the result.
        const model = this.viewer.model;
        this.pushpinEditStarted = true;
        const locationsExtension = await this.getLocationsExtensionAsync();
        
        if (locationsExtension && this.viewer.model === model && this.pushpinEditStarted) {
            if (this.options.showLocations) {
                locationsExtension.showAllLocations();
            }

            // Update initial hover for selected pushpin (before actually moving the mouse).
            if (this.selectedItem) {
                locationsExtension.hoverLocationsByIds(this.selectedItem.data.locationIds);
            }

            // Stop highlight when placing pushpin on 2D locations.
            this.highlightPausedBackup = this.viewer.isHighlightPaused();
            this.viewer.impl.pauseHighlight(true);
        }
    }

    onPushpinEditEnd() {
        // If item is still draggable, the edit is not really done.
        if (this.selectedItem && this.selectedItem.draggable) {
            return;
        }

        const explodeExt = this.viewer.getExtension('Autodesk.Explode');

        if (explodeExt) {
            explodeExt.setUIEnabled(true);
        }

        const locationsExtension = this.getLocationsExtension();

        if (locationsExtension) {
            locationsExtension.hideAllLocations();

            // Restore highlights.
            this.viewer.impl.pauseHighlight(this.highlightPausedBackup);
        }

        this.pushpinEditStarted = false;
    }

    getLocationIdsAtPoint(point) {
        const locationsExtension = this.getLocationsExtension();

        if (locationsExtension) {
            return locationsExtension.getLocationIdsAtPoint(point);
        }

        return [];
    }

    hoverLocations(event) {
        const locationsExtension = this.getLocationsExtension();

        if (locationsExtension) {
            locationsExtension.onMouseMove(event);
        }
    }
}

namespace.PushPinManager = PushPinManager;
