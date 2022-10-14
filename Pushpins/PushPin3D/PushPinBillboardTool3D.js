import PushPinBillboardLabel from '../PushPinLabel/PushPinBillboardLabel';
import { statusHexValues, moveableIcon, markerOffsets, ATTRIBUTES_VERSION } from '../PushPinConstants';
import { generateMetadata } from '../PushPins3D/PushPinViewerState';
import { applyModelTransform } from '../PushPinUtils';
import { vector3ApplyProjection } from '../../../thirdparty/three.js/three-legacy';

const av = Autodesk.Viewing;

export default class PushPinBillboardTool3D {
    constructor(viewer, options = {}) {
        this.names = ['pushpinBillboard3D'];

        this.viewer = viewer;
        this.setGlobalManager(viewer.globalManager);

        this.active = false;

        this.pushpins = [];
        this.selectedPushpin = null;
        this.dirty = false;
        this.camera = this.viewer.navigation.getCamera();

        const raycastLimitPerSecond = 200; // execute at most once every x milliseconds.
        this.maxMsPerRayCastCycle = 20;
        this.updateTimestamp = 0;

        this.tmpVec = new THREE.Vector3();
        this.tmpMatrix = new THREE.Matrix4();
        this.tmpFrustum = new THREE.Frustum();

        if (!options.disableOcclusionTest) {
            // Ray-casts for occlusion tests. The only purpose is to change the opacity of occluded PushPins, at the costs of:
            //  - Memory: Loading the externalID file (may be huge for large projects)
            //  - Performance: Repeatedly firing lots of raytests and worker tasks (#PushPins separate queries per camera change)
            this.raycastThrottle = this.throttle(() => {
                this.continueRayCasts();
            }, raycastLimitPerSecond);
        } else {
            // Bypass raycasts for occlusion checks.
            this.raycastThrottle = () => {};
        }
    }

    continueRayCasts() {
        const stamp = performance.now();
        let i = 0;
        for (; i < this.pushpins.length; i++) {
            const pushpin = this.pushpins[i];
            if (!pushpin.visible) {
                continue;
            }
            if (pushpin.updateTimestamp !== this.updateTimestamp) {
                pushpin.updateTimestamp = this.updateTimestamp;
                this.castRay(pushpin);
                if (performance.now() > stamp + this.maxMsPerRayCastCycle) {
                    break;
                }
            }
        }

        // Make sure that we continue if we couldn't do them all
        if (i < this.pushpins.length) {
            this.raycastThrottle();
        }
    }

    getNames() {
        return this.names;
    }

    getName() {
        return this.names[0];
    }

    isActive() {
        return this.active;
    }

    activate(name) {
        if (name === this.getName()) {
            this.active = true;

            this.onCameraChangeBinded = e => this.onCameraChange(e);
            this.handleResizeBinded = e => this.handleResize(e);

            this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
            this.viewer.addEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.onCameraChangeBinded);
            this.viewer.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.handleResizeBinded);
        }
    }

    throttle(callback, wait, context = this) {
        let timeout = null;
        let callbackArgs = null;

        const later = () => {
            timeout = null;
            callback.apply(context, callbackArgs);
        };

        return function () {
            if (!timeout) {
                callbackArgs = arguments;
                timeout = setTimeout(later, wait);
            }
        };
    }

    deactivate(name) {
        if (name === this.getName()) {
            this.active = false;

            this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
            this.viewer.removeEventListener(Autodesk.Viewing.MODEL_TRANSFORM_CHANGED_EVENT, this.onCameraChangeBinded);
            this.viewer.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.handleResizeBinded);
        }
    }

    onCameraChange() {
        this.updatePushpins();
    }

    project(pushpin) {
        const position = pushpin.marker.intersectPoint;
        const containerBounds = this.viewer.navigation.getScreenViewport();
        let p = this.tmpVec.copy(position);

        const model = pushpin.findModel(this.viewer);

        applyModelTransform(p, model);
        
        this.tmpMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);

        // We don't change visibility if pushpin is hidden anyway
        if (pushpin.visible) {
            this.tmpFrustum.setFromProjectionMatrix(this.tmpMatrix);
            (!this.tmpFrustum.containsPoint(p)) ? this.hideMarker(pushpin.marker) : this.showMarker(pushpin.marker);
        }

        p = vector3ApplyProjection(p, this.tmpMatrix);

        return new THREE.Vector3(
            Math.round(((p.x + 1) / 2) * containerBounds.width),
            Math.round(((-p.y + 1) / 2) * containerBounds.height),
            p.z
        );
    }

    unproject(position) {
        const containerBounds = this.viewer.navigation.getScreenViewport();
        const p = new THREE.Vector3();

        p.x = ((position.x / containerBounds.width) * 2) - 1;
        p.y = -(((position.y / containerBounds.height) * 2) - 1);
        p.z = position.z;
        p.unproject(this.camera);

        return p;
    }

    initNewPushpin(item) {
        item.intersectPoint = item.data.position;

        this.pushpins.push(item);

        this.createMarker(item);

        item.draggable ? this.enableDragging(item) : this.disableDragging(item);
        item.visible ? this.showMarker(item.marker) : this.hideMarker(item.marker);
    }

    fetchExternalId(model, dbId, callback) {
        return new Promise((resolve, reject) => {
            const onSuccessCallback = (props) => {
                let externalId = props.externalId;

                // For some files (i.e. STEP) the externalId is an array that contains the whole hierarchy of the element
                // Since we need only a string in the end we take the last element (the hierarchy is concatenated anyway,
                // so each element contains the whole information needed to identify it)
                if (externalId.startsWith('[') && externalId.endsWith(']')) {
                    try {
                        const parsedExternalId = JSON.parse(externalId);
                        if (Array.isArray(parsedExternalId)) {
                            externalId = parsedExternalId[parsedExternalId.length - 1];
                        }
                    } catch(e) {
                        console.error('Error ' + e + ' parsing externalId ', externalId);
                    }
                }

                // https://wiki.autodesk.com/pages/viewpage.action?spaceKey=saascore&title=Comparison+of+different+behaviors+between+SVF+and+SVF2
                // Look for "ifcGUID" in the wiki above - In SVF2, the ifcGUID is used as the externalID of object.
                if (!model.isOTG() && model.getData().loadOptions.fileExt === 'ifc') {
                    const ifcId = props.properties.find(el => el.displayName === 'IfcGUID' || (el.displayName === 'GLOBALID' && el.displayCategory === 'IFC'));
                    if (ifcId) {
                        externalId = ifcId.displayValue;
                    } else { // If there's no IFC id, look at the parent
                        const parentDbId = props.properties.find(el => el.displayName === 'parent' && el.displayValue > -1);
                        if (parentDbId) {
                            resolve(this.fetchExternalId(model, parentDbId.displayValue, callback));
                            return;
                        }
                    }
                }
                callback(externalId);
                resolve();
            };

            const onErrorCallback = (status, message, data) => {
                Autodesk.Viewing.Private.logger.warn(message);
                resolve(); // Log the message but don't fail
            };

            model.getProperties2(dbId, onSuccessCallback, onErrorCallback, { needsExternalId: true });
        });
    }

    createPushpin(item) {
        item.data.attributesVersion = ATTRIBUTES_VERSION;

        this.initNewPushpin(item);

        item.setViewerState(generateMetadata(this.viewer, item));

        this.selectPushpin(item);

        const vpVec = this.viewer.impl.clientToViewport(item.marker.position.x, item.marker.position.y);
        const res = this.viewer.impl.castRayViewport(vpVec, false);

        if (res) {
            item.setObjectId(res.dbId);
            item.setObjectData(res);

            const model = item.findModel(this.viewer);
            if (!model) {
                console.error('Failed to assign externalId: The model for this PushPin is not loaded.');
                return Promise.resolve();
            }

            return this.fetchExternalId(model, res.dbId, externalId => item.setExternalId(externalId));
        } else {
            return Promise.resolve();
        }
    }

    loadPushpin(item) {
        this.initNewPushpin(item);

        return Promise.resolve();
    }

    createMarker(pushpin) {
        const _document = this.getDocument();
        const marker = _document.createElement('div');
        pushpin.marker = marker;
        
        marker.id = pushpin.data.id;
        marker.intersectPoint = pushpin.intersectPoint;

        if (pushpin.hasPosition()) {
            const className = (pushpin.data.type === 'rfis') ? 'rfi-billboard-marker' : 'pushpin-billboard-marker';

            marker.classList.add(className);
            marker.style.backgroundColor = statusHexValues[pushpin.data.status];

            this.viewer.container.appendChild(marker);
            
            this.setMarkerPosition(pushpin);

            const xTranslate = pushpin.marker.position.x - (markerOffsets.markerOffsetWidth / 2);
            const yTranslate = pushpin.marker.position.y - (markerOffsets.markerOffsetWidth / 2);

            pushpin.marker.style.transform = `translate(${xTranslate}px, ${yTranslate}px)`;
        } else {
            // Imported issues (such as from BCF) can arrive without a position. They just store the camera state
            // In that case create a dummy marker (since the extension assumes it exists in many places) and don't 
            // add it to the viewer.container
            this.hideMarker(marker);
            pushpin.visible = false;
        }
    }

    removePushpin(pushpin) {
        this.pushpins = this.pushpins.filter((curPushpin) => {
            if (this.selectedPushpin && this.selectedPushpin.data.id === pushpin.data.id) {
                this.selectedPushpin = null;
            }

            return curPushpin.data.id !== pushpin.data.id;
        });

        this.destroyMarker(pushpin);
    }

    removeAll() {
        this.pushpins.forEach((pushpin) => {
            this.removePushpin(pushpin);
        });
    }

    destroyMarker(pushpin) {
        this.destroyLabel(pushpin);
        this.viewer.container.removeChild(pushpin.marker);
        pushpin.marker = undefined;
    }

    destroyLabel(pushpin) {
        if (pushpin.label) {
            pushpin.marker.removeChild(pushpin.label.container);
            pushpin.label = undefined;
        }
    }

    setMarkerPosition(pushpin) {
        pushpin.marker.position = this.project(pushpin);
    }

    updateStyle(status, size, hex) {
        statusHexValues[status] = hex;
        this.dirty = true;
    }

    castRay(pushpin) {
        const objectId = parseInt(pushpin.data.objectId, 10);
        if (isNaN(objectId) || objectId === -1) { // no check needed
            return;
        }

        const vpVec = this.viewer.impl.clientToViewport(pushpin.marker.position.x, pushpin.marker.position.y);
        const res = this.viewer.impl.castRayViewport(vpVec, false); 
        if (res && res.dbId) {
            if (pushpin.data.externalId) {
                return this.fetchExternalId(res.model, res.dbId, (externalId) => {
                    // it could happen that the pushpin was removed in the meantime
                    if (pushpin && pushpin.marker && pushpin.data) {
                        pushpin.marker.style.opacity = (externalId === pushpin.data.externalId) ? '1.0' : '0.15';
                    }
                });
            }
            if (pushpin.data.objectId && parseInt(pushpin.data.objectId, 10) !== -1) {
                pushpin.marker.style.opacity = (res.dbId === parseInt(pushpin.data.objectId, 10)) ? '1.0' : '0.15';
            }
        } else { // no object was hit
            pushpin.marker.style.opacity = '0.15';
        }
    }

    updatePushpins() {
        // Calc new position
        this.updateTimestamp++;
        this.raycastThrottle();

        this.pushpins.forEach((pushpin) => {
            this.setMarkerPosition(pushpin);
        });

        // Update the DOM
        this.pushpins.forEach((pushpin) => {
            const offsetWidth = pushpin.selected ? markerOffsets.selectedMarkerOffsetWidth : markerOffsets.markerOffsetWidth;

            const xTranslate = pushpin.marker.position.x - (offsetWidth / 2);
            const yTranslate = pushpin.marker.position.y - (offsetWidth / 2);

            pushpin.marker.style.transform = `translate(${xTranslate}px, ${yTranslate}px)`;

            if (this.dirty) {
                if (pushpin.label) {
                    pushpin.label.update(pushpin.data.label);
                }

                pushpin.draggable ? this.enableDragging(pushpin) : this.disableDragging(pushpin);
                pushpin.marker.style.backgroundColor = statusHexValues[pushpin.data.status];
                pushpin.visible ? this.showMarker(pushpin.marker) : this.hideMarker(pushpin.marker);
            }
        });

        this.dirty = false;
    }

    setDirty() {
        this.dirty = true;
    }

    selectPushpin(pushpin) {
        this.deselect();
        this.viewer.clearSelection();

        pushpin.label = new PushPinBillboardLabel(pushpin.marker, pushpin.data.label);
        pushpin.marker.classList.add('selected');

        this.selectedPushpin = pushpin;
    }

    deselect() {
        if (this.selectedPushpin) {
            this.destroyLabel(this.selectedPushpin);
            this.selectedPushpin.marker.style.pointerEvents = 'none';
            this.selectedPushpin.marker.classList.remove('selected');
            this.selectedPushpin = null;
        }
    }

    enableDragging(item) {
        if (this.selectedPushpin && this.selectedPushpin.data.id === item.data.id) {
            item.marker.style.pointerEvents = 'auto';
        }
        item.marker.style.backgroundImage = moveableIcon;
    }

    disableDragging(item) {
        const selectedItem = item || this.selectedPushpin;

        selectedItem.marker.style.pointerEvents = 'none';
        selectedItem.marker.style.backgroundImage = 'none';
        selectedItem.draggable = false;
    }

    hideLabel() {
        if (this.selectedPushpin) {
            this.selectedPushpin.label.hide();
        }
    }

    showMarker(marker) {
        marker.style.display = '';
    }

    hideMarker(marker) {
        marker.style.display = 'none';
    }

    showMarkers() {
        this.pushpins.forEach((pushpin) => {
            (pushpin.visible) ? this.project(pushpin) : this.hideMarker(pushpin.marker);
        });
    }

    hideMarkers() {
        this.pushpins.forEach((pushpin) => {
            this.hideMarker(pushpin.marker);
        });

        if (this.selectedPushpin) {
            this.destroyLabel(this.selectedPushpin);
        }
    }


    handleButtonDown(event, button) {
        return false;
    }

    handleButtonUp(event, button) {
        return false;
    }

    handleResize() {
        this.updatePushpins();
    }
}

av.GlobalManagerMixin.call(PushPinBillboardTool3D.prototype);

const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');

namespace.PushPinBillboardTool3D = PushPinBillboardTool3D;
