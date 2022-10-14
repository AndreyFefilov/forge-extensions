import PushPinVisButton from '../PushPinUi/PushPinVisButtonBase';

export default class RfiPushPinVisButton extends PushPinVisButton {
    constructor(viewer, extension, initiallyHidePushpins) {
        super(viewer, extension, initiallyHidePushpins);
        this.viewer = viewer;
        this.extension = extension;
        this.pushpinVisBtn = null;

        this.setButtonConstants();
    }

    setButtonConstants() {
        this.buttonConstants = {
            btnClass: 'toolbar-pushpinRfisVis',
            btnLabel: 'Show all rfis',
            noPushpinLabel: 'No RFI in current doc',
            hidePushpinLabel: 'Hide all RFIs',
            showPushpinLabel: 'Show all RFIs',
            pushpinNormalIcon: 'rfiicon-rfi_normal',
            pushpinHideIcon: 'rfiicon-rfi_hide',
        };

        this.type = this.extension.pushPinManager.PushPinTypes.RFIS;
    }
}
