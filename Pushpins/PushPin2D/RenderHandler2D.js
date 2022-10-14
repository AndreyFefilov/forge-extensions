import PushPinBillboardTool2D from '../PushPins2D/PushPinBillboardTool2D';
import PushPinInputHandler from '../PushPinInputHandler';
import { clientToWorld, convertPdfToLeaflet } from '../PushPinUtils';
import { PUSHPIN_EVENTS } from '../PushPinEvents';

const av = Autodesk.Viewing;

export default class RenderHandler2D {
    constructor(viewerApi, pushPinManager) {
        this.viewer = viewerApi;
        this.setGlobalManager(this.viewer.globalManager);
        this.pushPinManager = pushPinManager;
        this.pushpinDirty = false;
        this.selectedItem = null;

        this.onSelectedChangedBind = e => this.onSelectedChanged(e);
        this.onRemoveBind = e => this.onRemove(e);
        this.onRemoveAllBind = e => this.onRemoveAll(e);
        this.onModifyBind = e => this.onModify(e);
        this.onUpdateBind = e => this.onUpdate(e);
        this.createBind = e => this.create(e);
        this.onVisibilityChangedBind = e => this.onVisibilityChanged(e);
    }

    register() {
        this.pushpinBillboardTool = new PushPinBillboardTool2D(this.viewer);
        this.viewer.toolController.registerTool(this.pushpinBillboardTool);
    }

    deregister() {
        if (this.pushpinBillboardTool) {
            this.viewer.toolController.deregisterTool(this.pushpinBillboardTool);
            this.pushpinBillboardTool = null;
        }
    }

    activate() {
        if (!this.pushpinBillboardTool.isActive()) {
            this.viewer.toolController.activateTool('pushpinBillboard2D');
        }

        this.inputHandler = new PushPinInputHandler(this);

        this.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_SELECTED_EVENT, this.onSelectedChangedBind);
        this.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVED_EVENT, this.onRemoveBind);
        this.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVE_ALL_EVENT, this.onRemoveAllBind);
        this.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_MODIFY_EVENT, this.onModifyBind);
        this.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_UPDATE_EVENT, this.onUpdateBind);
        this.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_VISIBILITY_EVENT, this.onVisibilityChangedBind);
        this.pushPinManager.setCreateFunction(this.createBind);

        return true;
    }

    deactivate() {
        if (this.pushpinBillboardTool.isActive()) {
            this.viewer.toolController.deactivateTool('pushpinBillboard2D');
        }

        this.inputHandler.detach();

        this.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_SELECTED_EVENT, this.onSelectedChangedBind);
        this.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVED_EVENT, this.onRemoveBind);
        this.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVE_ALL_EVENT, this.onRemoveAllBind);
        this.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_MODIFY_EVENT, this.onModifyBind);
        this.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_UPDATE_EVENT, this.onUpdateBind);
        this.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_VISIBILITY_EVENT, this.onVisibilityChangedBind);
        this.pushPinManager.removeCreateFunction(this.createBind);

    }

    setPushpinDirty() {
        this.pushpinDirty = true;
    }

    onSelectedChanged(event) {
        if (event.value) {
            this.selectedItem = event.value;

            if (!this.selectedItem.marker) {
                this.create(this.selectedItem);
            }

            this.pushpinBillboardTool.selectPushpin(this.selectedItem);
            this.focusCameraOnSelectedItem(this.selectedItem);

            if (this.selectedItem.draggable) {
                this.enableItemDragging(this.selectedItem);
            }

            this.viewer.dispatchEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_SELECTED_EVENT });
        } else {
            this.deselectItem();
            this.pushpinBillboardTool.deselect();
        }

        this.setPushpinDirty();
    }

    deselectItem() {
        this.selectedItem = null;
        this.inputHandler.detach();
    }

    onRemove(event) {
        if (this.selectedItem && event.value.data.id === this.selectedItem.data.id) {
            this.deselectItem();
        }

        if (event.value && event.value.marker) {
            this.pushpinBillboardTool.removePushpin(event.value);
        }
    }

    onRemoveAll() {
        this.deselectItem();
        this.pushpinBillboardTool.removeAll();
    }

    onModify() {
        this.pushpinDirty = true;
    }

    onVisibilityChanged() {
        this.pushpinBillboardTool.showMarkers();
    }

    onUpdate() {
        setTimeout(() => {
            this.setPushpinDirty();

            // it could happen that the extension was removed in the meantime
            this.pushpinBillboardTool && this.pushpinBillboardTool.setDirty();
            const selectedItem = this.pushPinManager ? this.pushPinManager.getSelectedItem() : null;

            if (!selectedItem) {
                return;
            }

            (selectedItem.draggable && selectedItem.marker) ?
                this.enableItemDragging(selectedItem) :
                this.disableItemDragging(selectedItem);
        }, 1);
    }

    enableItemDragging(item) {
        this.pushpinBillboardTool.enableDragging(item);
        this.inputHandler.attachTo(item.marker);
    }

    disableItemDragging(item) {
        this.pushpinBillboardTool.disableDragging(item);
        this.inputHandler.detach();
    }

    create(item) {
        // iOS have a special case where they already have the UUID, so we act like we are re-selecting an existing item
        return this.createRenderItem(item, Autodesk.Viewing.isIOSDevice());
    }

    createRenderItem(item, reselect) {
        // Make sure it's a uuid and not a growing counter
        const isLoaded = (item.data.id.length > 20);

        // If we are actually creating a new pushpin (and not just loading one), make sure to deselect the previous selected one.
        if (!isLoaded) {
            this.pushpinBillboardTool.deselect();
        }

        let promise;
        if (isLoaded && !reselect) {
            promise = this.pushpinBillboardTool.loadPushpin(item);
        } else {
            promise = this.pushpinBillboardTool.createPushpin(item);
            this.pushPinManager.selectOne(item.data.id);
        }

        return promise;
    }

    updatePattern(status, size, hex) {
        this.pushpinBillboardTool.updateStyle(status, size, hex);

        this.setPushpinDirty();
    }

    focusCameraOnSelectedItem(item) {
        if (item.marker) {
            const padding = 0.2;

            const modelBounds = this.viewer.utilities.getBoundingBox(true);
            const modelWidth = (modelBounds.max.x - modelBounds.min.x) * padding;
            const modelHeight = (modelBounds.max.y - modelBounds.min.y) * padding;

            const min = new THREE.Vector3(item.marker.intersectPoint.x - modelWidth, item.marker.intersectPoint.y - modelHeight, 0);
            const max = new THREE.Vector3(item.marker.intersectPoint.x + modelWidth, item.marker.intersectPoint.y + modelHeight, 0);
            const bounds = new THREE.Box3(min, max);

            this.viewer.navigation.fitBounds(this.pushPinManager.restoreViewerStateImmediate, bounds, false);
        }
    }

    render() {
        if (!this.pushPinManager || !this.viewer.model) {
            return;
        }

        this.pushPinManager.items().reverse().forEach((item) => {
            if (!item.marker) {
                this.createRenderItem(item, false);
            }
        });

        if (this.pushpinDirty) {
            this.pushpinBillboardTool.updateContainerProjection();
            this.pushpinDirty = false;
        }
    }

    findIntersections(event) {
        const mouseX = event.clientX;
        const mouseY = event.clientY;

        let hitItem = null;

        this.pushPinManager.items().some((item) => {
            if (item.selectable && item.marker) {
                const bb = item.marker.getBoundingClientRect();
                if (mouseX > bb.left && mouseX < bb.left + bb.width && mouseY > bb.top && mouseY < bb.top + bb.height) {
                    hitItem = item;
                    return true;
                }
            }
            return false;
        });

        return hitItem;
    }

    handleMouseMove(e) {
        const self = this;
        function mouseCoords(ev) {
            if (ev.pageX || ev.pageY) {
                return { x: ev.pageX, y: ev.pageY };
            }

            const _document = self.getDocument();
            return {
                x: (ev.clientX + _document.body.scrollLeft) - _document.body.clientLeft,
                y: (ev.clientY + _document.body.scrollTop) - _document.body.clientTop
            };
        }

        if (this.selectedItem.marker && this.selectedItem.marker.startDragging) {
            // only on first mouse movement
            if (!this.newX) {
                this.selectedItem.marker.style.transform = 'translate(0px, 0px)';
            }

            const mousePos = mouseCoords(e);

            this.newX = mousePos.x - this.mouseOffset.x;
            this.newY = mousePos.y - this.mouseOffset.y;

            // Check left, top, right, bottom
            const containerBounds = this.viewer.navigation.getScreenViewport();
            const wi = this.selectedItem.marker.clientWidth;
            const hi = this.selectedItem.marker.clientHeight;

            if (this.newX < 5) {
                this.newX = 0;
            }
            if (this.newY < 5) {
                this.newY = 0;
            }
            if (containerBounds.width - 5 < this.newX + wi) {
                this.newX = containerBounds.width - wi;
            }
            if (containerBounds.height - 5 < this.newY + hi) {
                this.newY = containerBounds.height - hi;
            }

            const containerPosX = this.pushpinBillboardTool.pushpinContainer.position.x;
            const containerPosY = this.pushpinBillboardTool.pushpinContainer.position.y;

            this.selectedItem.marker.style.left = `${this.newX - containerPosX}px`;
            this.selectedItem.marker.style.top = `${this.newY - containerPosY}px`;

            this.selectedItem.marker.dragging = true;

            this.pushPinManager.hoverLocations(event);
        }
    }

    handleMouseUp(e) {
        if (this.selectedItem.marker) {
            if (this.selectedItem.marker.dragging) {
                const containerPosX = this.pushpinBillboardTool.pushpinContainer.position.x;
                const containerPosY = this.pushpinBillboardTool.pushpinContainer.position.y;

                this.selectedItem.marker.style.transform = `translate(${this.newX - containerPosX}px, ${this.newY - containerPosY}px)`;

                const result = clientToWorld(this.viewer, this.newX, this.newY);

                this.selectedItem.data.position = { x: result.x, y: result.y, z: result.z };

                this.pushPinManager.setItemLocationIds(this.selectedItem);
                this.pushPinManager.generateThumbnail(this.selectedItem).then((thumbnail) => {

                    const { x, y, z } = this.selectedItem.data.position; // Backup position.

                    if (this.viewer.model.isPdf(true)) {
                        convertPdfToLeaflet(this.viewer, this.selectedItem.data);
                    }

                    this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_MODIFY_EVENT, value: this.selectedItem, thumbnail });

                    this.selectedItem.data.position = { x, y, z }; // Restore position.
                });

                this.pushpinBillboardTool.removeAll();
                this.render();
                this.pushpinBillboardTool.selectPushpin(this.pushPinManager.selectedItem);
                if (this.selectedItem.draggable) {
                    this.enableItemDragging(this.selectedItem);
                }
            } else {
                this.selectedItem.marker.startDragging = false;
            }
        }
    }

    handleMouseDown(event) {
        function getOffset(e) {
            let left = 0;
            let top = 0;

            while (e.offsetParent) {
                left += e.offsetLeft;
                top += e.offsetTop;
                e = e.offsetParent;
            }

            left += e.offsetLeft;
            top += e.offsetTop;
            return { x: left, y: top };
        }

        if (this.selectedItem.marker) {
            if (event.target.tagName.toLowerCase() === 'textarea') {
                return;
            }

            this.mouseOffset = getOffset(this.viewer.container);

            this.newX = null;
            this.newY = null;

            this.selectedItem.marker.startDragging = true;
        }
    }
}

av.GlobalManagerMixin.call(RenderHandler2D.prototype);
