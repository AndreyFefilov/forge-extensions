import PushPinBillboardLabel from '../PushPinLabel/PushPinBillboardLabel';
import { vector3ApplyProjection } from '../../../thirdparty/three.js/three-legacy';
import { applyPdfWorldScaling } from '../PushPinUtils';
import { statusHexValues, moveableIcon, markerOffsets, ATTRIBUTES_VERSION } from '../PushPinConstants';

const av = Autodesk.Viewing;

export default class PushPinBillboardTool2D {
    constructor(viewer) {
        this.names = ['pushpinBillboard2D'];

        this.viewer = viewer;
        this.setGlobalManager(viewer.globalManager);
        this.active = false;

        this.pushpins = [];
        this.selectedPushpin = null;
        this.dirty = false;
        this.camera = this.viewer.navigation.getCamera();
        this.curCameraZ = 0;
        this.curCameraRotationZ = 0;

        this.tmpVec = new THREE.Vector3();
        this.tmpMatrix = new THREE.Matrix4();
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
            this.viewer.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.handleResizeBinded);

            this.createMarkerContainer();
        }
    }

    deactivate(name) {
        if (name === this.getName()) {
            this.active = false;

            this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChangeBinded);
            this.viewer.removeEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, this.handleResizeBinded);
        }
    }

    onCameraChange(e) {
        if (e.camera.position.z.toPrecision(5) !== this.curCameraZ.toPrecision(5) || e.camera.rotation.z.toPrecision(5) !== this.curCameraRotationZ.toPrecision(5)) {
            this.updatePushpinsProjection();
            this.curCameraZ = e.camera.position.z;
            this.curCameraRotationZ = e.camera.rotation.z;
        } else {
            this.updateContainerProjection();
        }
    }

    createMarkerContainer() {
        if (!this.pushpinContainer) {
            this.pushpinContainer = this.viewer.appendOrderedElementToViewer('pushpin-container');
            this.pushpinContainer.className = 'pushpin-container';
            this.pushpinContainer.position = new THREE.Vector3();
        }
    }

    project(pushpin) {
        const position = pushpin.marker.intersectPoint;
        const containerBounds = this.viewer.navigation.getScreenViewport();
        const p = this.tmpVec.copy(position);

        this.tmpMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);

        vector3ApplyProjection(p, this.tmpMatrix);

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
        if (this.viewer.model.isLeaflet()) {
            this.convertLeafletPosition(item);

            // https://jira.autodesk.com/browse/BLMV-2918
            // Update originalDocumentResolution when saving / updating a pushpin, in order to make sure that the pushpin will
            // maintain the same position for different DPIs of the same document.
            const modelData = this.viewer.model.getData();
            const options = modelData.loadOptions.loadOptions;
            item.setOriginalDocumentResolution([options.texWidth, options.texHeight]);
        } else {
            item.intersectPoint = item.data.position;
        }

        this.pushpins.push(item);

        this.createMarker(item);

        item.draggable ? this.enableDragging(item) : this.disableDragging(item);
        item.visible ? this.showMarker(item.marker) : this.hideMarker(item.marker);
    }

    createPushpin(item) {
        item.data.attributesVersion = ATTRIBUTES_VERSION;

        this.initNewPushpin(item);
        this.selectPushpin(item);

        return Promise.resolve();
    }

    convertLeafletPosition(item) {
        const worldPos = applyPdfWorldScaling(this.viewer, item.data);
        item.intersectPoint = { x: worldPos.x, y: worldPos.y, z: worldPos.z };
    }

    loadPushpin(item) {
        this.initNewPushpin(item);

        return Promise.resolve();
    }

    createMarker(pushpin) {
        const _document = this.getDocument();
        const marker = _document.createElement('div');

        const className = (pushpin.data.type === 'rfis') ? 'rfi-billboard-marker' : 'pushpin-billboard-marker';

        marker.classList.add(className);
        marker.style.backgroundColor = statusHexValues[pushpin.data.status];
        marker.style.boxShadow = '0px 1px 6px rgba(0, 0, 0, 0.6)';

        this.pushpinContainer.appendChild(marker);

        marker.id = pushpin.data.id;
        marker.intersectPoint = pushpin.intersectPoint;

        pushpin.marker = marker;
        this.setMarkerPosition(pushpin);

        // first pushpin
        if (this.pushpins.length === 1) {
            this.setPushpinContainerPosition(pushpin);
        } else {
            const newPosX = pushpin.marker.position.x - this.pushpinContainer.position.x;
            const newPosY = pushpin.marker.position.y - this.pushpinContainer.position.y;
            pushpin.marker.style.transform = `translate(${newPosX}px, ${newPosY}px)`;
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
        this.pushpinContainer.removeChild(pushpin.marker);
        pushpin.marker = undefined;
    }

    destroyLabel(pushpin) {
        if (pushpin.label) {
            pushpin.marker.removeChild(pushpin.label.container);
            pushpin.label = undefined;
        }
    }

    setPushpinContainerPosition(pushpin) {
        const xTranslate = pushpin.marker.position.x - (markerOffsets.markerOffsetWidth / 2);
        const yTranslate = pushpin.marker.position.y - (markerOffsets.markerOffsetWidth / 2);

        this.pushpinContainer.initPos = pushpin.intersectPoint;
        this.pushpinContainer.position.x = pushpin.marker.position.x;
        this.pushpinContainer.position.y = pushpin.marker.position.y;
        this.pushpinContainer.style.transform = `translate(${xTranslate}px, ${yTranslate}px)`;
    }

    setMarkerPosition(pushpin) {
        pushpin.marker.position = this.project(pushpin);
    }

    updateStyle(status, size, hex) {
        statusHexValues[status] = hex;
        this.dirty = true;
    }

    updateContainerProjection() {
        if (this.pushpins.length > 0) {
            const newPosition = { marker: { intersectPoint: this.pushpinContainer.initPos } };
            const updatedPosition = this.pushpinContainer.position = this.project(newPosition);
            const offsetWidth = markerOffsets.markerOffsetWidth;

            const xTranslate = updatedPosition.x - (offsetWidth / 2);
            const yTranslate = updatedPosition.y - (offsetWidth / 2);

            this.pushpinContainer.style.transform = `translate(${xTranslate}px, ${yTranslate}px)`;
        }

        // Update the DOM
        this.pushpins.forEach((pushpin) => {
            this.updatePushpin(pushpin);
        });

        this.dirty = false;
    }

    updatePushpinsProjection() {
        this.redraw = true;
        this.pushpins.forEach((pushpin) => {
            this.setMarkerPosition(pushpin);
        });

        this.pushpins.forEach((pushpin) => {
            if (this.redraw) {
                this.setPushpinContainerPosition(pushpin);
                this.redraw = false;
            }

            const xPos = pushpin.marker.position.x - this.pushpinContainer.position.x;
            const yPos = pushpin.marker.position.y - this.pushpinContainer.position.y;
            pushpin.marker.style.transform = `translate(${xPos}px, ${yPos}px)`;

            this.updatePushpin(pushpin);
        });

        this.dirty = false;
    }

    updatePushpin(pushpin) {
        if (this.dirty) {
            if (pushpin.label) {
                pushpin.label.update(pushpin.data.label);
            }

            pushpin.draggable ? this.enableDragging(pushpin) : this.disableDragging(pushpin);
            pushpin.marker.style.backgroundColor = statusHexValues[pushpin.data.status];
            pushpin.visible ? this.showMarker(pushpin.marker) : this.hideMarker(pushpin.marker);
        }
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
        pushpin.draggable ? this.enableDragging(pushpin) : this.disableDragging(pushpin);
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

    showMarker(marker) {
        marker.style.display = '';
    }

    hideMarker(marker) {
        marker.style.display = 'none';
    }

    showMarkers() {
        this.pushpins.forEach((pushpin) => {
            (pushpin.visible) ? this.showMarker(pushpin.marker) : this.hideMarker(pushpin.marker);
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
        setTimeout(() => {
            this.updatePushpinsProjection();
        }, 1);
    }
}

av.GlobalManagerMixin.call(PushPinBillboardTool2D.prototype);
const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');

namespace.PushPinBillboardTool2D = PushPinBillboardTool2D;
