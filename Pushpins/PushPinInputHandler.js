export default class PushPinInputHandler {
    constructor(pushpinRenderer) {
        this.pushpin = null;
        this.pushpinRenderer = pushpinRenderer;
        this.mousePosition = { x: 0, y: 0 };

        this.onTouchDragBinded = this.onTouchDrag.bind(this);
        this.onMouseMoveBinded = this.onMouseMove.bind(this);
        this.onMouseUpBinded = this.onMouseUp.bind(this);
        this.onMouseDownBinded = this.onMouseDown.bind(this);
        this.onHammerInputBinded = this.onHammerInput.bind(this);

        this.mouseEnabled = false;
        this.mousePrevValue = false;
        this.lock = false;
    }

    // Convert Hammer touch-event X,Y into mouse-event X,Y.
    static convertEventHammerToMouse(event) {
        event.shiftKey = false;
        event.clientX = event.pointers[0].clientX;
        event.clientY = event.pointers[0].clientY;
    }

    processMouseEvent(event) {
        this.mousePosition.x = event.clientX;
        this.mousePosition.y = event.clientY;
    }

    attachTo(pushpin) {
        if (this.pushpin) {
            this.detach();
        }

        this.pushpin = pushpin;

        if (Autodesk.Viewing.isTouchDevice()) {
            this.hammer = new Autodesk.Viewing.Hammer.Manager(pushpin, {
                recognizers: [
                    Autodesk.Viewing.GestureRecognizers.drag
                ],
                inputClass: Autodesk.Viewing.isIE11 ? Hammer.PointerEventInput : Hammer.TouchInput
            });

            this.hammer.on('dragstart dragmove dragend', this.onTouchDragBinded);
            this.hammer.on('hammer.input', this.onHammerInputBinded);
        }

        if (!Autodesk.Viewing.isMobileDevice()) {
            this.enableMouseButtons(true);
        }
    }

    onHammerInput(event) {
        this.setMouseDisabledWhenTouching(event);
    }

    setMouseDisabledWhenTouching(event) {
        if (event.isFirst && !this.lock) {
            this.enableMouseButtons(false);
            this.lock = true;
        } else if (event.isFinal) {
            setTimeout(() => {
                this.enableMouseButtons(this.mousePrevValue);
                this.lock = false;
            }, 10);
        }
    }

    enableMouseButtons(state) {
        if (state && !this.mouseEnabled) {
            this.pushpin.addEventListener('mousedown', this.onMouseDownBinded);
            this.pushpinRenderer.viewer.container.addEventListener('mousemove', this.onMouseMoveBinded);
            this.pushpinRenderer.viewer.container.addEventListener('mouseup', this.onMouseUpBinded);
        } else if (!state && this.mouseEnabled) {
            this.pushpin.removeEventListener('mousedown', this.onMouseDownBinded);
            this.pushpinRenderer.viewer.container.removeEventListener('mousemove', this.onMouseMoveBinded);
            this.pushpinRenderer.viewer.container.removeEventListener('mouseup', this.onMouseUpBinded);
        }

        this.mousePrevValue = this.mouseEnabled;
        this.mouseEnabled = state;
    }

    detach() {
        if (this.hammer) {
            this.hammer.destroy();
        }

        this.pushpinRenderer.viewer.container.removeEventListener('mousemove', this.onMouseMoveBinded);
        this.pushpinRenderer.viewer.container.removeEventListener('mouseup', this.onMouseUpBinded);

        if (this.pushpin) {
            this.pushpin.removeEventListener('mousedown', this.onMouseDownBinded);

            this.pushpin = null;
        }

        this.mouseEnabled = false;
    }

    onMouseMove(event) {
        this.processMouseEvent(event);
        this.pushpinRenderer.handleMouseMove(event);
        event.preventDefault();
    }

    onMouseDown(event) {
        this.processMouseEvent(event);
        this.pushpinRenderer.handleMouseDown(event);
        event.preventDefault();
    }

    onMouseUp(event) {
        this.processMouseEvent(event);
        this.pushpinRenderer.handleMouseUp(event);
        event.preventDefault();
    }

    onTouchDrag(event) {
        PushPinInputHandler.convertEventHammerToMouse(event);
        switch (event.type) {
            case 'dragstart':
                this.onMouseDown(event);
                break;
            case 'dragmove':
                this.onMouseMove(event);
                break;
            case 'dragend':
                this.onMouseUp(event);
                break;
            default:
                break;
        }

        event.preventDefault();
    }
}

const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');
namespace.PushPinInputHandler = PushPinInputHandler;
