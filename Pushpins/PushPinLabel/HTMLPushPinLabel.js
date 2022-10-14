const av = Autodesk.Viewing;
const _document = av.getGlobal().document;

export default class HTMLPushPinLabel {
    constructor() {
        this.container = _document.createElement('div');
        this.container.className = 'leaflet-text-label';
        this.text = '';
        this.dirty = false;
    }

    setParent(parent) {
        if (this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        if (parent) {
            parent.appendChild(this.container);
        }
    }

    set(textString) {
        if (this.text === textString) {
            return;
        }

        this.container.innerHTML = '<span>' + textString + '</span>';
        this.text = textString;

        const textWidth = this.container.firstChild.clientWidth;
        let bgWidth = textWidth + 20;

        if (bgWidth < 60) {
            bgWidth = 60;
        }

        this.container.style.width = bgWidth.toString() + 'px';

        let top = 10;
        let left = 0;

        if (this.container.clientWidth !== 0) {
            const containerHeight = this.container.parentNode.clientHeight;
            top += containerHeight;

            const containerWidth = this.container.parentNode.clientWidth;
            left = (containerWidth - this.container.clientWidth) * 0.5;
        } else {
            // if label client width is null, need refresh label again.
            return;
        }

        top = top.toString() + 'px';
        left = left.toString() + 'px';

        if (this.container.style.top !== top) {
            this.container.style.top = top;
        }

        if (this.container.style.left !== left) {
            this.container.style.left = left;
        }
        this.dirty = false;
    }
}

const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');

namespace.HTMLPushPinLabel = HTMLPushPinLabel;
