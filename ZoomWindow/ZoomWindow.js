'use strict';

import ZoomWindowTool from './ZoomWindowTool';

const av = Autodesk.Viewing;
const namespace = AutodeskNamespace('Autodesk.Viewing.Extensions.ZoomWindow');

import './ZoomWindow.css'; // IMPORTANT!!

/**
 * Extends the dolly (zoom) button on the toolbar with a tool for end users to specify
 *  a rectangular section for the camera to zoom into and adjust accordingly.
 * 
 * The extension id is: `Autodesk.Viewing.ZoomWindow`
 * 
 * @example
 *   viewer.loadExtension('Autodesk.Viewing.ZoomWindow')
 * 
 * @memberof Autodesk.Viewing.Extensions
 * @alias Autodesk.Viewing.Extensions.ZoomWindow
 * @see {@link Autodesk.Viewing.Extension} for common inherited methods.
 * @class
 */
export default class ZoomWindow extends av.Extension {
    
    constructor(viewer, options) {
        super(viewer, options);
        this.name = 'zoomwindow';
        this.modes = ['zoomwindow','dolly'];
    }

    load() {
        var viewer = this.viewer;

        // Init & Register tool
        this.tool = new ZoomWindowTool(viewer);
        viewer.toolController.registerTool(this.tool);

        return true;
    }

    onToolbarCreated(toolbar) {
        var navTools = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLSID);

        if (!navTools || !navTools.dollybutton) {
            return;
        }

        var self = this;
        // remove default zoom tool
        navTools.removeControl(navTools.dollybutton.getId());
        this.defaultDollyButton = navTools.dollybutton;

        // add combo button for zoom tool
        this.zoomWindowToolButton = new Autodesk.Viewing.UI.ComboButton('toolbar-zoomTools');
        this.zoomWindowToolButton.setIcon('zoomwindowtoolicon-zoom-window');
        this.zoomWindowToolButton.setToolTip('Zoom window');
        this.createZoomSubmenu(this.zoomWindowToolButton);
        navTools.addControl(this.zoomWindowToolButton);

        // Escape hotkey to exit tool.
        //
        var hotkeys = [{
            keycodes: [ Autodesk.Viewing.KeyCode.ESCAPE ],
            onRelease: function () {
                if (self.zoomWindowToolButton.getState() === Autodesk.Viewing.UI.Button.State.ACTIVE) {
                    self.viewer.setActiveNavigationTool();
                    self.zoomWindowToolButton.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
                }
            }
        }];
        this.viewer.getHotkeyManager().pushHotkeys(this.escapeHotkeyId, hotkeys);
    }

    destroyUI() {
        var viewer = this.viewer;
        if (this.zoomWindowToolButton) {
            var toolbar = viewer.getToolbar();
            var navTools = toolbar && toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLSID);
            if (navTools) {
                this.zoomWindowToolButton.subMenu.removeEventListener(
                    Autodesk.Viewing.UI.RadioButtonGroup.Event.ACTIVE_BUTTON_CHANGED,
                    this.zoomWindowToolButton.subMenuActiveButtonChangedHandler(navTools));
                navTools.removeControl(this.zoomWindowToolButton.getId());
                // set back dolly button
                if (navTools.panbutton && this.defaultDollyButton) {
                    navTools.addControl(this.defaultDollyButton);
                }
                else {
                    this.defaultDollyButton = null;
                }
            }
            this.zoomWindowToolButton = null;
        }
        viewer.getHotkeyManager().popHotkeys(this.escapeHotkeyId);
    }


    createZoomSubmenu(parentButton){

        var createNavToggler = function(self, button, name) {
            return function() {
                var state = button.getState();
                if (state === Autodesk.Viewing.UI.Button.State.INACTIVE) {
                    self.activate(name);
                    button.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
                } else if (state === Autodesk.Viewing.UI.Button.State.ACTIVE) {
                    self.deactivate();
                    button.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
                }
            };
        };

        // zoom window
        var zoomWindowToolBut = new Autodesk.Viewing.UI.Button('toolbar-zoomWindowTool');
        zoomWindowToolBut.setToolTip(Autodesk.Viewing.i18n.translate("Zoom window"));
        zoomWindowToolBut.setIcon('zoomwindowtoolicon-zoom-window');
        zoomWindowToolBut.onClick = createNavToggler(this, zoomWindowToolBut, 'zoomwindow');
        parentButton.addControl(zoomWindowToolBut);
        // zoom
        var dollyBut = new Autodesk.Viewing.UI.Button('toolbar-zoomTool');
        dollyBut.setToolTip('Zoom');
        dollyBut.setIcon('adsk-icon-zoom');
        dollyBut.onClick = createNavToggler(this, dollyBut, 'dolly');
        parentButton.addControl(dollyBut);
    }

    unload() {
        var viewer = this.viewer;
        if (viewer.getActiveNavigationTool() === "dolly" ||
            viewer.getActiveNavigationTool() === "zoomwindow") {
            viewer.setActiveNavigationTool();
        }
        // Remove the UI
        this.destroyUI();
        // Deregister tool
        viewer.toolController.deregisterTool(this.tool);
        this.tool = null;

        return true;
    }

    /**
     * Activates either ZoomWindow or dolly/zoom tool.
     * 
     * @param {string} [mode='zoomwindow'] - Either 'zoomwindow' or 'dolly'
     * @memberof Autodesk.Viewing.Extensions.ZoomWindow
     * @alias Autodesk.Viewing.Extensions.ZoomWindow#activate
     */
    activate(mode) {
        if (this.activeStatus && this.mode === mode) {
            return;
        }
        switch (mode) {
            default:
            case 'zoomwindow':
                this.viewer.setActiveNavigationTool('zoomwindow');
                this.mode = 'zoomwindow';
                break;
            case 'dolly':
                this.viewer.setActiveNavigationTool('dolly');
                this.mode ='dolly';
                break;
        }
        this.activeStatus = true;
        return true;
    }

    /**
     * Deactivates the tool and resets the navigation tool.
     * 
     * @memberof Autodesk.Viewing.Extensions.ZoomWindow
     * @alias Autodesk.Viewing.Extensions.ZoomWindow#deactivate
     */
    deactivate() {
        if (this.activeStatus) {
            this.viewer.setActiveNavigationTool();
            this.activeStatus = false;
        }
        return true;
    }

}

namespace.ZoomWindow = ZoomWindow;
Autodesk.Viewing.theExtensionManager.registerExtension('Autodesk.Viewing.ZoomWindow', ZoomWindow);
