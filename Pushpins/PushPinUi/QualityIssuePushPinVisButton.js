import PushPinVisButton from '../PushPinUi/PushPinVisButtonBase';

export default class QualityIssuePushPinVisButton extends PushPinVisButton {
    constructor(viewer, extension, initiallyHidePushpins) {
        super(viewer, extension, initiallyHidePushpins);
        this.viewer = viewer;
        this.extension = extension;
        this.pushpinVisBtn = null;

        this.setButtonConstants();
    }

    setButtonConstants() {
        this.buttonConstants = {
            btnClass: 'toolbar-pushpinFieldIssuesVis',
            btnLabel: 'Show all field pushpins',
            noPushpinLabel: 'No field issue in current doc',
            hidePushpinLabel: 'Hide all field issues',
            showPushpinLabel: 'Show all field issues',
            pushpinNormalIcon: 'fieldissueicon-issue_normal',
            pushpinHideIcon: 'fieldissueicon-issue_hide'
        };

        this.type = this.extension.pushPinManager.PushPinTypes.QUALITY_ISSUES;
    }
}
