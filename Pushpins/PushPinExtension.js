import { PUSHPIN_EVENTS } from './PushPinEvents';
import PushPinManager from './PushPinManager';
import PushPinTool from './PushPinTools';
import IssuePushPinVisButton from './PushPinUi/IssuePushPinVisButton';
import RfiPushPinVisButton from './PushPinUi/RfiPushPinVisButton';
import QualityIssuePushPinVisButton from './PushPinUi/QualityIssuePushPinVisButton';
import PushPinMobileObserver from './PushPinObserver';
import { applyLegacyFallback, legacyToLocalPushPinData, getLegacyPushPinData } from './PushPinLegacyFallback';
import { locales } from './PushPinLocales';

import CSS from './PushPinExtension.css'; // REQUIRED!!

const namespace = AutodeskNamespace('Autodesk.BIM360.Extension.PushPin');

export default class PushPinExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options = {}) {
        super(viewer, options);
        this.viewer = viewer;
        this.options = options;
        Autodesk.Viewing.EventDispatcher.prototype.apply(this);
    }

    load() {
        this.extendLocalization(locales);

        this.onModelAdded = this.onModelAdded.bind(this);
        this.onModelRemoved = this.onModelRemoved.bind(this);
        this.viewer.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.onModelAdded);
        this.viewer.addEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.onModelRemoved);

        if (this.viewer.getVisibleModels().length > 0) {
            this.onModelAdded();
        }

        return true;
    }

    unload() {
        this.destroyUI();

        this.destroyPushpinManager();

        this.destroyTool();

        this.viewer.removeEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, this.onModelAdded);
        this.viewer.removeEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, this.onModelRemoved);

        return true;
    }

    onModelAdded() {
        // Need to initialize pushpinManager & pushpinTool in these cases:
        // - pushpinManager or tool weren't initialized yet
        // - viewer switched mode from 2D to 3D (or 3D to 2D)
        const reset = !this.pushPinManager || !this.tool ||
            // For 3D is2d is undefined, so first convert to boolean
            Boolean(this.viewer.impl.is2d) !== this.pushPinManager.is2D;

        if (reset) {
            this.initPushpinManager();
            this.initTool();
            this.createUI();

            for (const value of Object.values(PUSHPIN_EVENTS)) {
                // Forward the events to the pushpin manager
                // Removing is not necessary as the pushpin manager gets recreated
                this.pushPinManager.addEventListener(value, (e) => this.fireEvent(e));
            }
            this.fireEvent({ type: Events.PUSH_PIN_MANAGER_INITIALIZED, value: this.pushPinManager });
        }
    }

    onModelRemoved() {
        // In case that there is no model left on the viewer.
        if (this.viewer.getVisibleModels().length === 0) {
            this.destroyUI();
            this.destroyPushpinManager();
            this.destroyTool();

            this.fireEvent({ type: Events.PUSH_PIN_MANAGER_DESTROYED });
        }
    }

    initPushpinManager() {
        // Clean previous instance of pushpin manager if exists.
        this.destroyPushpinManager();

        this.pushPinManager = new PushPinManager(this.viewer, this.options);

        if (Autodesk.Viewing.isMobileDevice()) {
            this.observer = new PushPinMobileObserver(this.pushPinManager);
        }
    }

    destroyPushpinManager() {
        if (this.pushPinManager) {
            this.pushPinManager.selectNone();
            this.pushPinManager.removeAllItems();
            this.pushPinManager = null;
        }

        this.observer = null;
    }

    initTool() {
        // Clean previous instance of pushpin tool if exists.
        this.destroyTool();

        this.tool = new PushPinTool(this.viewer, this.pushPinManager, this.options && this.options.selectionOverrideHandler);

        this.viewer.toolController.registerTool(this.tool);
        this.viewer.toolController.activateTool(this.tool.getName());
    }

    destroyTool() {
        if (this.tool) {
            this.viewer.toolController.deregisterTool(this.tool);
            this.tool = null;
        }
    }

    /**
     * Public interfaces routing to tool for clients to call
     */
    startCreateItem(data) {
        this.tool.startCreateItem(data);
        this.updateButtonsStatus();
        this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_EDIT_START_EVENT });
    }

    endCreateItem() {
        this.tool.endCreateItem();
        this.updateButtonsStatus();
        this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_EDIT_END_EVENT });
    }

    showAll() {
        for (var type in this.pushPinManager.PushPinTypes) {
            this.showByType(this.pushPinManager.PushPinTypes[type]);
        }
    }

    hideAll() {
        for (var type in this.pushPinManager.PushPinTypes) {
            this.hideByType(this.pushPinManager.PushPinTypes[type]);
        }
    }

    enableItemSelect(enable) {
        this.tool.enablePushPinSelect(enable);
    }

    updatePattern(id, size, res) {
        this.tool.renderTool.updatePattern(id, size, res);
    }

    // public interfaces routing to push pin manager for clients to call
    loadItems(pushPinDatas) {
        if (this.viewer.getVisibleModels().length === 0) {
            console.warn('model need to be loaded before using loadItems API');
            return;
        }

        if (this.viewer.model.is3d()) {
            console.warn('loadItems is deprecated for 3D models. Use loadItemsV2 instead.');
        }

        this.tool.show(true);
        this.pushPinManager.addItems(pushPinDatas);
        this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_ITEMS_LOADED, value: null });
    }

    // @param {bool} [blockEvent=false] - By default, we fire a PUSH_PIN_ITEMS_LOADED event each time to make sure that 
    //                                    it's never missed. If you call this function several times in a loop, you can block
    //                                    the event as long as you ensure to fire it once at the end of the loop.
    loadItemFromLocal(pushPinData, blockEvent) {
        if (this.viewer.getVisibleModels().length === 0) {
            console.warn('model need to be loaded before using loadItemFromLocal API');
            return;
        }

        this.pushPinManager.addItems([pushPinData], true, this.viewer);

        if (!blockEvent) {
            this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_ITEMS_LOADED, value: null });
        }
    }

    // New load API that encapsulates the 2D/3D loading APIs.
    loadItemsV2(pushpinsData) {
        if (this.viewer.getVisibleModels().length === 0) {
            console.warn('model need to be loaded before using loadItemsV2 API');
            return;
        }

        if (!Array.isArray(pushpinsData)) {
            pushpinsData = [pushpinsData];
        }

        // Activate tool so pushpins will be visible.
        this.tool.show(true);

        pushpinsData.forEach(pushpinData => {
            if (this.viewer.model.is3d()) {
                // For legacy reasons, issue positions are not directly stored in model-local coordinates. So we need some legacy conversion.
                this.legacyToLocalPushPinData(pushpinData);

                // Now, position and viewerState are in model-local coordinates.
                this.loadItemFromLocal(pushpinData, true);
            } else {
                // Old code path for 2D issues.
                this.pushPinManager.addItems([pushpinData]);
            }
        });

        this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_ITEMS_LOADED, value: null });
    }

    updateItemById(id, data) {
        return this.pushPinManager.updateItemById(id, data);
    }

    getItemById(id) {
        const item = this.pushPinManager.getItemById(id);

        if (item) {
            return item.data;
        }

        return null;
    }

    setDraggableById(id, isDraggable, cancelPositionChange) {

        // Note that this.pushPinManager may temporarily destroyed when removing the last model
        // during a view switch. We tolerate that case in the same way as we handle a call for a non-existing issue.
        const item = this.pushPinManager?.getItemById(id);

        if (item) {
            if (cancelPositionChange) {
                item.setPosition(this.origItemPosition);
            }

            item.draggable = isDraggable;
            this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_UPDATE_EVENT, value: item });
            this.origItemPosition = Object.assign({}, item.data.position);

            if (isDraggable) {
                this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_EDIT_START_EVENT });
            } else {
                this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_EDIT_END_EVENT });
            }
        }
    }

    setVisibleById(id, isVisible) {
        const item = this.pushPinManager.getItemById(id);
        if (item) {
            item.visible = isVisible;
            this.pushPinManager.fireEvent({ type: PUSHPIN_EVENTS.PUSH_PIN_UPDATE_EVENT, value: item });
        }
    }

    /**
     * Select one pushpin
     * @param id Issue id
     * @param reTriggerEvent Allows to force a re-triggering of the selection event, even if pushpin was selected before.
     * This makes sense if you want to make sure that the pushpin viewer state is applied anyway (zoom to pushpin).
     */
    selectOne(id, reTriggerEvent) {
        this.pushPinManager && this.pushPinManager.selectOne(id, reTriggerEvent);
    }

    selectNone() {
        this.pushPinManager && this.pushPinManager.selectNone();
    }

    removeItemById(id) {
        const item = this.pushPinManager.getItemById(id);

        if (!item) {
            return;
        }

        this.pushPinManager.removeItemById(id);
    }

    removeItemsByType(type) {
        this.pushPinManager.removeItemsByType(type);
    }

    removeAllItems() {
        this.pushPinManager && this.pushPinManager.removeAllItems();
    }

    createUI() {
        // UI depends on pushpinManager.
        this.destroyUI();

        this.uiButtons = [];

        if (!this.options.hideIssuesButton) {
            this.uiButtons.push(new IssuePushPinVisButton(this.viewer, this, this.options.initiallyHideIssuesPushpins));
        }

        if (!this.options.hideFieldIssuesButton) {
            this.uiButtons.push(new QualityIssuePushPinVisButton(this.viewer, this, this.options.initiallyHideFieldIssuesPushpins));
        }

        if (!this.options.hideRfisButton) {
            this.uiButtons.push(new RfiPushPinVisButton(this.viewer, this, this.options.initiallyHideRfisPushpins));
        }

        if (this.viewer.model) {
            // If model is already loaded, then check.
            this.uiButtons.forEach((uiButton) => {
                uiButton.addButton();
            });
            return;
        }

        const self = this;

        function enableVisButton() {
            if (self.viewer.model) {
                self.uiButtons.forEach((uiButton) => {
                    uiButton.addButton();
                });
            }
            self.viewer.removeEventListener(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, enableVisButton);
        }

        // Otherwise, watch model loaded event.
        this.viewer.addEventListener(Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT, enableVisButton);
    }

    destroyUI() {
        if (!this.uiButtons) {
            return;
        }

        this.uiButtons.forEach((uiButton) => {
            uiButton.destroyButton();
        });

        this.uiButtons = null;
    }

    updateButtonsStatus() {
        this.uiButtons.forEach((uiButton) => {
            uiButton.updateButtonStatus();
        });
    }

    hideByType(type) {
        this.pushPinManager && this.pushPinManager.setVisibleByType(type, false);
    }

    showByType(type) {
        this.pushPinManager && this.pushPinManager.setVisibleByType(type, true);
    }

    // Convert legacy 3D pushPinData in-place to make sure that positions and viewerState are consistently in model-local coords.
    legacyToLocalPushPinData(pushPinData) {

        legacyToLocalPushPinData(pushPinData, this.viewer);

        // Usually, this will be a no-op. It will just detect and auto-repair some previously saved
        // PushPins that would be broken otherwise.
        if (this.options.useLegacyFallback) {
            applyLegacyFallback(pushPinData, this.viewer);
        }
    }

    // Takes a PushPinItem and returns its PushPinData - transformed in a way that it is compatible with the PushPins as stored in issues-backend. For this, pushPin position
    // must match with viewer coordinates when using a single model with default loadOptions (default globalOffset and no transforms).
    getLegacyPushPinData(pushPin) {
        return getLegacyPushPinData(pushPin, this.viewer);
    }

    // Makes restore viewer state immediate (without animation)
    setRestoreViewerStateImmediate(restoreViewerStateImmediate) {
        if (this.pushPinManager) {
            this.pushPinManager.restoreViewerStateImmediate = restoreViewerStateImmediate;
        }
    }
}

const Events = {
    PUSH_PIN_MANAGER_INITIALIZED: 'pushpin.manager.initialized',
    PUSH_PIN_MANAGER_DESTROYED: 'pushpin.manager.destroyed',
};

PushPinExtension.Events = Events;

namespace.PUSH_PIN_EXT_NAME = 'Autodesk.BIM360.Extension.PushPin';
Object.assign(namespace, PUSHPIN_EVENTS);
Autodesk.Viewing.theExtensionManager.registerExtension(namespace.PUSH_PIN_EXT_NAME, PushPinExtension);
