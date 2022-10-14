import { PUSHPIN_EVENTS } from './PushPinEvents';
import { clientToWorld, invertModelTransform } from "./PushPinUtils";
import { cursorIcon } from './PushPinConstants';
import RenderHandler2D from './PushPins2D/RenderHandler2D';
import RenderHandler3D from './PushPins3D/RenderHandler3D';

const av = Autodesk.Viewing;

export default class PushPinTool {
    constructor(viewer, pushPinManager, selectionOverrideHandler) {
        this.setGlobalManager(viewer.globalManager);

        this.names = ['pushpin'];
        this.priority = 45;
        this.pushpinCursor = cursorIcon;

        this.isActive = false;
        this.pushPinInitData = null;
        this.viewer = viewer;
        this.pushPinManager = pushPinManager;
        this.createMode = false;

        this.selectionOverrideHandler = selectionOverrideHandler;

        // This is for test
        this.testId = '1111122222333334444455555';
        this.autoCreate = false;
        // test end
    }

    getNames() {
        return this.names;
    }

    getName() {
        return this.names[0];
    }

    getPriority() {
        return this.priority;
    }

    setAutoCreate(auto) {
        this.autoCreate = auto;
    }

    getCursor() {
        if (this.createMode) {
            return this.pushpinCursor;
        }
        return this.isHover ? 'pointer' : null;
    }

    register() {
        // Init render tool
        if (!this.renderTool) {
            if (this.pushPinManager.is2D) {
                this.renderTool = new RenderHandler2D(this.viewer, this.pushPinManager);
            } else {
                this.renderTool = new RenderHandler3D(this.viewer, this.pushPinManager);
            }

            this.renderTool.register();
        }
    }

    deregister() {
        if (this.renderTool) {
            this.renderTool.deregister();
            this.renderTool = null;
        }
    }

    activate(name, viewerApi) {
        if (name === this.getName()) {
            this.renderTool.activate();
            this.isActive = true;
        }
    }

    deactivate(name) {
        if (name === this.getName()) {
            this.show(false);
            this.isActive = false;
        }
    }

    update() {
        if (this.isActive) {
            if (this.duringShowing && this.renderTool) {
                this.renderTool.render();
            }
        }

        // return false, because push pin render doesn't affect LMV model.
        return false;
    }

    show(duringShowing) {
        this.duringShowing = duringShowing;
    }

    enablePushPinSelect(enable) {
        this.pushPinManager.items().forEach((item) => {
            item.selectable = enable;
        });
    }

    // Each time client initiate push pin create with default info and one at a time
    startCreateItem(data) {
        if (this.isActive) {
            const controller = this.viewer.toolController;
            if (controller && controller.getActiveToolName() !== this.getName()) {
                controller.deactivateTool(this.getName());
                controller.activateTool(this.getName());
            }

            if (!this.duringShowing) {
                this.show(true);
            }

            this.pushPinInitData = data;
            this.createMode = true;
            this.enablePushPinSelect(false);
        }

        this.viewer.dispatchEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_SELECTED_EVENT });
    }

    endCreateItem() {
        this.pushPinInitData = null;

        if (this.createMode) {
            this.createMode = false;
            this.enablePushPinSelect(true);
        }
    }

    createThreePushPin(event) {
        let pushPin = null;
        const clientX = event.canvasX;
        const clientY = event.canvasY;
        let result;
        if (!this.pushPinManager.isPseudo2D) {
            result = this.viewer.impl.clientToWorld(clientX, clientY);
        } else {
            result = {
                point: this.viewer.impl.intersectGround(clientX, clientY)
            };
        }
         
        if (result && this.pushPinInitData) {
            this.pushPinInitData.position = new THREE.Vector3(result.point.x, result.point.y, result.point.z);
            invertModelTransform(this.pushPinInitData.position, result.model);
            this.pushPinInitData.seedURN = result.model?.getSeedUrn();

            pushPin = this.pushPinManager.createItem(this.pushPinInitData);
            // Clear pin pin init data, as it is a one time data for creating only one push pin.
            this.pushPinInitData = null;
        }

        return pushPin;
    }

    createTwoPushPin(event) {
        let pushPin = null;
        const clientX = event.canvasX;
        const clientY = event.canvasY;
        const result = clientToWorld(this.viewer, clientX, clientY);

        if (result && this.pushPinInitData) {
            this.pushPinInitData.position = { x: result.x, y: result.y, z: result.z };

            pushPin = this.pushPinManager.createItem(this.pushPinInitData);
            // Clear pin pin init data, as it is a one time data for creating only one push pin.
            this.pushPinInitData = null;
        }

        return pushPin;
    }

    createPushPin(event) {
        if (this.autoCreate && !this.pushPinInitData) {
            // Fake push pin data for auto create.
            this.pushPinInitData = { id: (this.testId + '1'), status: 'issues-open', type: 'issues' };
        }

        if (this.pushPinInitData) {
            return this.pushPinManager.is2D ? this.createTwoPushPin(event) : this.createThreePushPin(event);
        }

        return false;
    }

    // Below is the standard input handler, so far only care about single click for creating push pins.
    handleSingleTap(event) {
        PushPinTool.convertEventHammerToMouse(event);

        return this.handleSingleClick(event, 0);
    }

    triggerPushpinClick(item) {
        if (this.selectionOverrideHandler) {
            // Let the client handle the selection of pushpins
            this.selectionOverrideHandler(item.data);
        } else {
            this.pushPinManager.selectOne(item.data.id);
            this.pushPinManager.fireEvent({
                type: PUSHPIN_EVENTS.PUSH_PIN_CLICKED_EVENT,
                value: this.pushPinManager.getSelectedItem()
            });
        }
    }

    checkPushpinClick(event) {
        return this.renderTool.findIntersections(event);
    }

    handleSingleClick(event, button) {
        const pressedItem = this.checkPushpinClick(event);
        let triggered = false;

        if (!this.createMode) {
            // Trigger selection only when createMode is false
            if (pressedItem) {
                this.triggerPushpinClick(pressedItem);
                triggered = true;
            } else if (this.pushPinManager.selectedItem) {
                this.pushPinManager.selectNone();
                this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_SELECT_NONE, value: null });
            }
        }

        if (this.isActive && button === 0) {
            if (pressedItem) {
                if (!triggered) {
                    this.triggerPushpinClick(pressedItem);
                }
            } else {
                return this.createPushPin(event);
            }
        }

        if (pressedItem) {
            const self = this;
            // Prevent from other listeners to be alerted for this current click.
            // This is necessary for a scenario when there is a pushpin on top of a callout rectangle for example.
            this.addDocumentEventListener('click',
                function handler(e) {
                    e.stopPropagation();
                    self.removeDocumentEventListener('click', handler, true);
                }, true);
        }

        return !!pressedItem;
    }

    handleMouseMove(event) {
        const hoveredItem = this.checkPushpinClick(event);

        this.isHover = !!hoveredItem;
        
        const isEditingPushpin = this.pushPinManager.selectedItem && this.pushPinManager.selectedItem.draggable;

        // When we are in pushpin edit mode, we want to update the hover of the location only when we actively drag the pushpin.
        // In case the pushpin is draggable, but not we just move the mouse without dragging - don't do anything.
        if (!isEditingPushpin) {
          this.pushPinManager.hoverLocations(event);
        }

        return false;
    }

    static convertEventHammerToMouse(event) {
        // Convert Hammer touch-event X,Y into mouse-event X,Y.
        event.shiftKey = false;
        event.clientX = event.pointers[0].clientX;
        event.clientY = event.pointers[0].clientY;
    }

}

av.GlobalManagerMixin.call(PushPinTool.prototype);

const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');

namespace.PushPinTool = PushPinTool;
