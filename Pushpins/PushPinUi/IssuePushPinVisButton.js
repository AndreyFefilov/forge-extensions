import PushPinVisButton from '../PushPinUi/PushPinVisButtonBase';

export default class IssuePushPinVisButton extends PushPinVisButton {
    constructor(viewer, extension, initiallyHidePushpins) {
        super(viewer, extension, initiallyHidePushpins);
        this.viewer = viewer;
        this.extension = extension;
        this.pushpinVisBtn = null;

        this.setButtonConstants();
    }

    setButtonConstants() {
        this.buttonConstants = {
            btnClass: 'toolbar-pushpinVis',
            btnLabel: 'Show all pushpins',
            noPushpinLabel: 'No issue in current doc',
            hidePushpinLabel: 'Hide all issues',
            showPushpinLabel: 'Show all issues',
            pushpinNormalIcon: 'issueicon-issue_normal',
            pushpinHideIcon: 'issueicon-issue_hide',
        };

        this.type = this.extension.pushPinManager.PushPinTypes.ISSUES;
    }
}
