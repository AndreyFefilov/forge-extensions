export const statusHexValues = {
    /* Issues */

    'issues-draft': '#819099',
    'issues-draft-selected': '#819099',
    'issues-draft-movable': '#819099',

    'issues-open': '#ffba0c',
    'issues-open-selected': '#ffba0c',
    'issues-open-movable': '#ffba0c',

    'issues-answered': '#087cd9',
    'issues-answered-selected': '#087cd9',
    'issues-answered-movable': '#087cd9',

    'issues-closed': '#bcc9d1',
    'issues-closed-selected': '#bcc9d1',
    'issues-closed-movable': '#bcc9d1',

    /* RFIs */

    'rfis-draft': '#819099',
    'rfis-draft-selected': '#819099',
    'rfis-draft-movable': '#819099',

    'rfis-submitted': '#7a77d9',
    'rfis-submitted-selected': '#7a77d9',
    'rfis-submitted-movable': '#7a77d9',

    'rfis-open': '#ffba0c',
    'rfis-open-selected': '#ffba0c',
    'rfis-open-movable': '#ffba0c',

    'rfis-answered': '#087cd9',
    'rfis-answered-selected': '#087cd9',
    'rfis-answered-movable': '#087cd9',

    'rfis-rejected': '#ff495c',
    'rfis-rejected-selected': '#ff495c',
    'rfis-rejected-movable': '#ff495c',

    'rfis-closed': '#bcc9d1',
    'rfis-closed-selected': '#bcc9d1',
    'rfis-closed-movable': '#bcc9d1',

    'rfis-void': '#bcc9d1',
    'rfis-void-selected': '#bcc9d1',
    'rfis-void-movable': '#bcc9d1',


    /* Field Issues */

    'quality_issues-draft': '#819099',
    'quality_issues-draft-selected': '#819099',
    'quality_issues-draft-movable': '#819099',

    'quality_issues-not_approved': '#ff495c',
    'quality_issues-not_approved-selected': '#ff495c',
    'quality_issues-not_approved-movable': '#ff495c',

    'quality_issues-open': '#ffba0c',
    'quality_issues-open-selected': '#ffba0c',
    'quality_issues-open-movable': '#ffba0c',

    'quality_issues-ready_to_inspect': '#7a77d9',
    'quality_issues-ready_to_inspect-selected': '#7a77d9',
    'quality_issues-ready_to_inspect-movable': '#7a77d9',

    'quality_issues-void': '#bcc9d1',
    'quality_issues-void-selected': '#bcc9d1',
    'quality_issues-void-movable': '#bcc9d1',

    'quality_issues-work_completed': '#087cd9',
    'quality_issues-work_completed-selected': '#087cd9',
    'quality_issues-work_completed-movable': '#087cd9',

    // "in_dispute" pushpins are the same as "not_approved" ones
    'quality_issues-in_dispute': '#ff495c',
    'quality_issues-in_dispute-selected': '#ff495c',
    'quality_issues-in_dispute-movable': '#ff495c',

    // "closed" pushpins are the same as "void" ones
    'quality_issues-closed': '#bcc9d1',
    'quality_issues-closed-selected': '#bcc9d1',
    'quality_issues-closed-movable': '#bcc9d1',

    'quality_issues-answered': '#087cd9',
    'quality_issues-answered-selected': '#087cd9',
    'quality_issues-answered-movable': '#087cd9'
};

export const moveableIcon = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEsAAABMCAYAAAAlS0pSAAAA4UlEQVR42u3bSw7DIAwFwNz/zhXddNVuoPWHlHkHCGKUgG0p1yVyTMYrJGDFQwFbhAIGKw8KGKw8KGCLUMBg5UEdDQYrGeo4sBEUWLC0O7BgwYIFCxYsWLBgwYL1r1jRm8nGasPP3Ew2VhlY1Waqnl96ntwdKxytagjXifXzOtUTy26sr9YbMoeGaAIMywIaDm+Yc2sbKKVDcr2lKP1c6KHd0Ugb0WwxojH8M1aGBUtgwYIFCxYsgQUL1iYofkeB1Q/mcwQFqw3MzQgrHkwlOglGCJZ2B9YdwIhMgpGAJfKWJ1qioD8mrIWXAAAAAElFTkSuQmCC)';

export const cursorIcon = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACIAAAAiCAYAAAA6RwvCAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAIxJREFUeNpi/P//PwMlgJGR0QBIfQCa84ASc5gYKAcTgDiBUkOo4RCqgFGHjDpk1CGjDhl1yKhDRoxDGIFYgcJqPAVK3yHXAGBbxoEF1KgBYgcKHPIHiEHmHKCgcaXASIUWWgPIIyBfjSbWUYeMOmTUIaMOGXXIqEOGVMOICs0AUMNKAGjOBUrMAQgwAFWiHzqojsmJAAAAAElFTkSuQmCC)16 16, auto';

export const markerOffsets = {
    markerOffsetWidth: 30, // .pushpin-billboard-marker height + (border*2)
    selectedMarkerOffsetWidth: 38 // .pushpin-billboard-marker.selected height + (border*2)
};

export const thumbnailOriginalPixelSize = 200; // Original crop size
export const thumbnailSize = 800; // Output size of the thumbnail
export const thumbnailZoom = thumbnailSize / thumbnailOriginalPixelSize;
export const thumbnailMarkerRadius = 10 * thumbnailZoom;

// ATTRIBUTES_VERSION is used in order to track changes of the pushpin attributes.
// Change this number only if there is a code change that requires a distinction between pushpins created before & after that change.
//
// V1: Legacy pushpins
// V2: applyOffsetToCutplanes is being applied to pushpins' cutplanes. https://git.autodesk.com/A360/firefly.js/pull/3046
export const ATTRIBUTES_VERSION = 2;
