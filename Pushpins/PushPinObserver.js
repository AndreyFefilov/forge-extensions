const av = Autodesk.Viewing;
const _window = av.getGlobal();
export default class PushPinMobileObserver {
    constructor(pushpinManager) {
        this.pushpinManager = pushpinManager;

        this.addListeners();
    }

    addListeners() {
        this.pushpinManager.addEventListener(Autodesk.BIM360.Extension.PushPin.PUSH_PIN_CREATED_EVENT, function (event) {
            PushPinMobileObserver.postMessage('onPushPinCreated', event);
        });

        this.pushpinManager.addEventListener(Autodesk.BIM360.Extension.PushPin.PUSH_PIN_PREPARING_THUMBNAIL , function (event) {
            PushPinMobileObserver.postMessage('onPushPinPreparingThumbnail', event);
        });

        this.pushpinManager.addEventListener(Autodesk.BIM360.Extension.PushPin.PUSH_PIN_CLICKED_EVENT, function (event) {
            PushPinMobileObserver.postMessage('onPushPinActived', event);
        });

        this.pushpinManager.addEventListener(Autodesk.BIM360.Extension.PushPin.PUSH_PIN_MODIFY_EVENT, function (event) {
            PushPinMobileObserver.postMessage('onPushPinMoved', event);
        });

        this.pushpinManager.addEventListener(Autodesk.BIM360.Extension.PushPin.PUSH_PIN_SELECT_NONE, function (event) {
            PushPinMobileObserver.postMessage('onPushPinSelectNone', event);
        });

        this.pushpinManager.addEventListener(Autodesk.BIM360.Extension.PushPin.PUSH_PIN_UPDATE_EVENT, function (event) {
            PushPinMobileObserver.postMessage('onPushPinUpdated', event);
        });

        this.pushpinManager.addEventListener(Autodesk.BIM360.Extension.PushPin.PUSH_PIN_ITEMS_LOADED, function (event) {
            PushPinMobileObserver.postMessage('onPushPinItemsLoaded', event);
        });

        PushPinMobileObserver.postMessage('onPushPinToolLoaded', {});
    }

    static postMessage(messageName, event) {
        const pushPinItem = event.value;
        const thumbnail = event.thumbnail || '';

        let metadata = {};

        if (pushPinItem) {
            metadata = {
                id: pushPinItem.data.id,
                label: pushPinItem.data.label,
                status: pushPinItem.data.status,
                position: {
                    x: pushPinItem.data.position.x,
                    y: pushPinItem.data.position.y,
                    z: pushPinItem.data.position.z
                },
                type: pushPinItem.data.type,
                objectId: pushPinItem.data.objectId,
                externalId: pushPinItem.data.externalId,
                viewerState: pushPinItem.data.viewerState,
                attributesVersion: pushPinItem.getAttributesVersion(),
                locationIds: pushPinItem.data.locationIds || [],
            };
        }

        if (_window.webkit !== undefined) {
            // New iOS SDK uses a standard callback method with the pattern of "command" and "data", just like MobileCallbacks.js
            _window.webkit.messageHandlers.callbackHandler.postMessage({ command: messageName, data: { metadata, thumbnail } });
        } else if (_window.JSINTERFACE) {
            // Android
            if (!pushPinItem) {
                _window.JSINTERFACE[messageName]();
            } else {
                _window.JSINTERFACE[messageName](metadata.id, metadata.type, metadata.label, metadata.status,
                    metadata.position.x, metadata.position.y, metadata.position.z, metadata.objectId,
                    JSON.stringify(metadata.viewerState), metadata.externalId, metadata.attributesVersion, JSON.stringify(metadata.locationIds), thumbnail);
            }
        }
    }
}
