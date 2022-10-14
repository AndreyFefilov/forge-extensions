import HTMLPushPinLabel from '../PushPinLabel/HTMLPushPinLabel';

export default class PushPinBillboardLabel extends HTMLPushPinLabel {
    constructor(marker, labelText) {
        super();

        this.createLabel(marker, labelText);
        this.visible = true;
    }

    createLabel(marker, labelText) {
        super.setParent(marker);
        this.update(labelText);
    }

    get isVisible() {
        return this.visible;
    }

    set isVisible(isVisible) {
        this.visible = isVisible;
    }

    update(labelText) {
        super.set(labelText);

        this.container.style.top = PushPinBillboardLabel.TOP_PADDING;
        this.container.style.left = (this.container.style.width / 3) + 'px';
    }

    show() {
        this.visible = true;
        this.container.style.display = 'block';
    }

    hide() {
        this.visible = false;
        this.container.style.display = 'none';
    }
}

PushPinBillboardLabel.TOP_PADDING = '50px';

const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');

namespace.PushPinBillboardLabel = PushPinBillboardLabel;
