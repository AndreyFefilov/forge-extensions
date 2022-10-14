import { PUSHPIN_EVENTS } from '../PushPinEvents';

const av = Autodesk.Viewing;

export default class PushPinVisButton {
    constructor(viewer, extension, initiallyHidePushpins) {
        this.viewer = viewer;
        this.setGlobalManager(viewer.globalManager);
        this.extension = extension;
        this.pushpinVisBtn = null;
        this.initiallyHidePushpins = initiallyHidePushpins;

        this.setButtonConstants();
    }

    setButtonConstants() {
        this.buttonConstants = {
            btnClass: '',
            btnLabel: '',
            noPushpinLabel: '',
            hidePushpinLabel: '',
            showPushpinLabel: '',
            pushpinNormalIcon: '',
            pushpinHideIcon: ''
        };

        this.type = '';
    }

    get pushPinButton() {
        return this.pushpinVisBtn;
    }

    createButton() {
        const btn = new Autodesk.Viewing.UI.Button(this.buttonConstants.btnClass);
        btn.setGlobalManager(this.globalManager);

        btn.setToolTip(Autodesk.Viewing.i18n.translate(this.buttonConstants.btnLabel));
        btn.setIcon(this.buttonConstants.pushpinNormalIcon);

        btn.onClick = () => {
            const state = btn.getState();
            if (state === Autodesk.Viewing.UI.Button.State.DISABLED) {
                return;
            }

            btn.setState(state === Autodesk.Viewing.UI.Button.State.INACTIVE ? Autodesk.Viewing.UI.Button.State.ACTIVE : Autodesk.Viewing.UI.Button.State.INACTIVE);
        };

        return btn;
    }

    onPushpinVisBtnStateChange(e) {
        if (e.state === Autodesk.Viewing.UI.Button.State.DISABLED) {
            this.pushpinVisBtn.setToolTip(Autodesk.Viewing.i18n.translate(this.buttonConstants.noPushpinLabel));
            return;
        }

        let showAll = e.state === Autodesk.Viewing.UI.Button.State.ACTIVE && !this.initiallyHidePushpins;
        if (this.initiallyHidePushpins) {
            this.pushpinVisBtn.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
            this.initiallyHidePushpins = false;
        }

        // Toggle the vis button
        if (showAll) {
            this.extension.tool.show(true);
            this.extension.showByType(this.type);
            this.pushpinVisBtn.setToolTip(Autodesk.Viewing.i18n.translate(this.buttonConstants.hidePushpinLabel));
            this.pushpinVisBtn.setIcon(this.buttonConstants.pushpinNormalIcon);
        } else {
            this.extension.hideByType(this.type);
            this.pushpinVisBtn.setToolTip(Autodesk.Viewing.i18n.translate(this.buttonConstants.showPushpinLabel));
            this.pushpinVisBtn.setIcon(this.buttonConstants.pushpinHideIcon);
        }
    }

    addButton() {
        if (this.pushpinVisBtn || !this.viewer.getToolbar) {
            return;
        }

        const toolbar = this.viewer.getToolbar();

        if (!toolbar) {
            return;
        }

        let modelTools = toolbar.getControl(Autodesk.Viewing.TOOLBAR.MODELTOOLSID);

        if (!modelTools) {
            // insert model tool below navgiation tool
            const navigationBar = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLSID);
            const toolbarOptions = {};

            toolbarOptions.index = (navigationBar) ? toolbar.indexOf(navigationBar) + 1 : 0;

            modelTools = new Autodesk.Viewing.UI.ControlGroup(Autodesk.Viewing.TOOLBAR.MODELTOOLSID);
            modelTools.setGlobalManager(this.globalManager);
            toolbar.addControl(modelTools, toolbarOptions);
        }

        this.pushpinVisBtn = this.createButton();

        // Add button to the toolbar
        this.pushpinVisBtn.addEventListener(Autodesk.Viewing.UI.Button.Event.STATE_CHANGED, (e) => {
            this.onPushpinVisBtnStateChange(e);
        });
        this.updateButtonStatus();
        modelTools.addControl(this.pushpinVisBtn);

        // add event listener to update visual button status
        this.extension.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVED_EVENT, () => {
            this.updateButtonStatus();
        });
        this.extension.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVE_ALL_EVENT, () => {
            this.updateButtonStatus();
        });
        this.extension.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_CREATED_EVENT, () => {
            this.updateButtonStatus();
        });
        this.extension.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_ITEMS_LOADED, () => {
            this.updateButtonStatus();
        });
        this.extension.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_PREPARING_THUMBNAIL, () => {
            this.updateButtonStatus();
        });
        this.extension.pushPinManager.addEventListener(PUSHPIN_EVENTS.PUSH_PIN_ITEMS_LOADED, () => {
            this.updateButtonStatus();
        });
    }

    updateButtonStatus() {
        if (!this.pushpinVisBtn) {
            return;
        }

        // during push pin is creating, show all push pins and disable show/hide button
        if (this.extension.tool.createMode) {
            if (this.pushpinVisBtn.getState() !== Autodesk.Viewing.UI.Button.State.DISABLED) {
                this.pushpinVisBtn.setState(Autodesk.Viewing.UI.Button.State.DISABLED);
            }
        } else {
            const issuePushpinCount = this.extension.pushPinManager.getItemCountByType(this.type);
            const issueButtonDisable = this.pushpinVisBtn.getState() === Autodesk.Viewing.UI.Button.State.DISABLED;

            if (issuePushpinCount > 0 && issueButtonDisable) {
                this.pushpinVisBtn.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
            } else if (issuePushpinCount === 0 && !issueButtonDisable) {
                this.pushpinVisBtn.setState(Autodesk.Viewing.UI.Button.State.DISABLED);
            }
        }
    }

    destroyButton() {
        if (!this.pushpinVisBtn) {
            return;
        }

        this.extension.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVED_EVENT, this.updateButtonStatus);
        this.extension.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_REMOVE_ALL_EVENT, this.updateButtonStatus);
        this.extension.pushPinManager.removeEventListener(PUSHPIN_EVENTS.PUSH_PIN_CREATED_EVENT, this.updateButtonStatus);

        const toolbar = this.viewer.getToolbar();

        if (toolbar) {
            this.pushpinVisBtn.removeFromParent();
        }

        this.pushpinVisBtn.removeEventListener(Autodesk.Viewing.UI.Button.Event.STATE_CHANGED, this.onPushpinVisBtnStateChange);
        this.pushpinVisBtn = null;
    }
}

av.GlobalManagerMixin.call(PushPinVisButton.prototype);
