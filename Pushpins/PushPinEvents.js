export const PUSHPIN_EVENTS = {
    PUSH_PIN_EDIT_START_EVENT: 'pushpin.edit.start',
    PUSH_PIN_EDIT_END_EVENT: 'pushpin.edit.end',
    PUSH_PIN_PREPARING_THUMBNAIL: 'pushpin.preparing.thumbnail',
    PUSH_PIN_CREATED_EVENT: 'pushpin.created',
    PUSH_PIN_SELECTED_EVENT: 'pushpin.selected',
    PUSH_PIN_REMOVED_EVENT: 'pushpin.removed',
    PUSH_PIN_REMOVE_ALL_EVENT: 'pushpin.remove.all',
    PUSH_PIN_MODIFY_EVENT: 'pushpin.modified', // this will be fired on push pin position changed.
    PUSH_PIN_UPDATE_EVENT: 'pushpin.update', // this will be fired on an explicit push pin data update.
    PUSH_PIN_VISIBILITY_EVENT: 'pushpin.visibility.changed',
    PUSH_PIN_ITEMS_LOADED: 'pushpin.tool.items.loaded',

    // Separate events to distinguish that they are triggered from client by direct API call.
    // This is a workaround to fix some problems on mobile client.
    // Mobile is going to rely on this event to get push pin select status.
    PUSH_PIN_CLICKED_EVENT: 'pushpin.clicked',
    PUSH_PIN_SELECT_NONE: 'pushpin.select.none'
};
