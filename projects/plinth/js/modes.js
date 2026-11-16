/**
 * modes.js — the modelling modes.
 *
 * A mode is a working context: which tools the toolbar offers, what a tap
 * selects, and which tool is active when the mode is entered. All modes work
 * on the same document, so switching never changes geometry.
 *
 * To add a mode: add an entry here, give it a home tool (a Tool subclass
 * registered in app.js) and list its toolbar groups. Tool ids in `groups`
 * refer to TOOL_BUTTONS in ui/chrome.js, where each button also says when it
 * is relevant: the toolbar only shows tools that can act on the current
 * selection.
 */
export const MODES = {
  object: {
    label: 'Object', icon: 'cube', tool: 'select',
    about: 'Whole objects: select, move, combine',
    groups: [['select', 'move', 'rotate', 'scale'], ['multi'], ['extrude'], ['union', 'subtract', 'intersect'], ['fillet', 'chamfer'], ['add', 'photo']],
  },
  edit: {
    label: 'Edit', icon: 'editMode', tool: 'edit',
    about: 'Faces, edges and points of one object',
    groups: [['vertex', 'edge', 'face'], ['multi'], ['pushpull', 'combine', 'split', 'fillet', 'chamfer']],
  },
  sketch: {
    label: 'CAD Sketch', icon: 'sketch', tool: 'sketch',
    about: 'Draw 2D profiles on a plane',
    groups: [],
  },
};
