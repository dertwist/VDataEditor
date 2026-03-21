// Delegate KV3 serialisation/parsing to the shared library (format/kv3.js).
const { jsonToKV3, kv3ToJSON } = KV3Format;

// ===== DATA MODEL =====
let doc = {
  generic_data_type: "CSmartPropRoot",
  m_Children: [],
  m_Variables: []
};
let nextElementId = 1;
let selectedNodePath = null; // path like "children.0.m_Modifiers.1"
let currentFileName = 'Untitled';
let currentFilePath = null; // full path when opened via Electron IPC; null when browser-only
let undoStack = [], redoStack = [], maxUndo = 50;
let sliderDragging = false, sliderDragUndoPushed = false;
let expandedNodes = new Set(['root','children','variables']);
let showModifiersInTree = true;
let showSelectionCriteriaInTree = true;
let clipboard = null;

// ===== ELEMENT/OPERATOR/FILTER DEFINITIONS =====
const ELEMENT_DEFS = {
  Group:{_class:'CSmartPropElement_Group', defaults:{}, hasChildren:true},
  Model:{_class:'CSmartPropElement_Model', defaults:{m_sModelName:'',m_bForceStatic:true,m_vModelScale:null,m_MaterialGroupName:null,m_bDetailObject:false,m_bRigidDeformation:false,m_nLodLevel:-1,m_DetailObjectFadeLevel:'MEDIUM'}, hasChildren:false},
  SmartProp:{_class:'CSmartPropElement_SmartProp', defaults:{m_sSmartProp:'',m_vModelScale:null}, hasChildren:false},
  PlaceOnPath:{_class:'CSmartPropElement_PlaceOnPath', defaults:{m_PathName:'path',m_vPathOffset:null,m_flOffsetAlongPath:null,m_PathSpace:null,m_flSpacing:128.0,m_SpacingSpace:'WORLD',m_bContinuousSpline:true,m_bUseFixedUpDirection:true,m_bUseProjectedDistance:true,m_vUpDirection:null,m_UpDirectionSpace:'WORLD'}, hasChildren:true},
  PlaceInSphere:{_class:'CSmartPropElement_PlaceInSphere', defaults:{m_nCountMin:0,m_nCountMax:0,m_flPositionRadiusInner:0,m_flPositionRadiusOuter:0,m_flRandomness:null,m_bAlignOrientation:false,m_PlacementMode:'SPHERE',m_DistributionMode:'RANDOM',m_vAlignDirection:null,m_vPlaneUpDirection:null}, hasChildren:true},
  PlaceMultiple:{_class:'CSmartPropElement_PlaceMultiple', defaults:{m_nCountMin:0,m_nCountMax:0,m_flSpacing:null,m_PlacementMode:null,m_bRandomizeOrder:null}, hasChildren:true},
  PickOne:{_class:'CSmartPropElement_PickOne', defaults:{m_SelectionMode:'RANDOM',m_SpecificChildIndex:0,m_OutputChoiceVariableName:'',m_bConfigurable:false,m_vHandleOffset:null,m_HandleColor:null,m_HandleSize:32,m_HandleShape:null}, hasChildren:true},
  FitOnLine:{_class:'CSmartPropElement_FitOnLine', defaults:{m_vStart:null,m_vEnd:null,m_PointSpace:'ELEMENT',m_bOrientAlongLine:false,m_vUpDirection:null,m_UpDirectionSpace:'WORLD',m_bPrioritizeUp:false,m_nScaleMode:'NONE',m_nPickMode:'SEQUENCE'}, hasChildren:true},
  ModifyState:{_class:'CSmartPropElement_ModifyState', defaults:{}, hasChildren:false},
  BendDeformer:{_class:'CSmartPropElement_BendDeformer', defaults:{m_bDeformationEnabled:true,m_vSize:null,m_vOrigin:null,m_vAngles:null,m_flBendAngle:null,m_flBendPoint:null,m_flBendRadius:null}, hasChildren:false},
  ModelEntity:{_class:'CSmartPropElement_ModelEntity', defaults:{m_sModelName:'',m_vModelScale:null,m_MaterialGroupName:null,m_bDetailObject:false,m_bRigidDeformation:false,m_nLodLevel:-1,m_DetailObjectFadeLevel:'MEDIUM'}, hasChildren:false},
  PropPhysics:{_class:'CSmartPropElement_PropPhysics', defaults:{m_sModelName:'',m_vModelScale:null,m_MaterialGroupName:null,m_flMass:50.0,m_bStartAsleep:false,m_nHealth:100,m_bEnableMotion:true,m_sPhysicsType:'normal'}, hasChildren:false},
  PropDynamic:{_class:'CSmartPropElement_PropDynamic', defaults:{m_sModelName:'',m_sAnimationSequence:'',m_sDefaultAnimation:'',m_vModelScale:null,m_MaterialGroupName:null}, hasChildren:false},
  MidpointDeformer:{_class:'CSmartPropElement_MidpointDeformer', defaults:{m_bDeformationEnabled:true,m_vStart:null,m_vEnd:null,m_fRadius:50.0,m_bContinuousSpline:true,m_vOffset:null,m_vAngles:null,m_vScale:null,m_fFalloff:0.5,m_OutputVariable:''}, hasChildren:false},
  Layout2DGrid:{_class:'CSmartPropElement_Layout2DGrid', defaults:{m_flWidth:512.0,m_flLength:512.0,m_bVerticalLength:false,m_GridArrangement:'SEGMENT',m_GridOriginMode:'CENTER',m_nCountW:4,m_nCountL:4,m_flSpacingWidth:128.0,m_flSpacingLength:128.0,m_bAlternateShift:false,m_flAlternateShiftWidth:0.0,m_flAlternateShiftLength:0.0}, hasChildren:true}
};
// Which elements can have children
const CHILD_ELEMENTS = new Set(['CSmartPropElement_Group','CSmartPropElement_PlaceOnPath','CSmartPropElement_PlaceInSphere','CSmartPropElement_PlaceMultiple','CSmartPropElement_PickOne','CSmartPropElement_FitOnLine','CSmartPropElement_Layout2DGrid','CSmartPropElement_BendDeformer','CSmartPropElement_MidpointDeformer']);

const OPERATOR_DEFS = {
  Rotate:{_class:'CSmartPropOperation_Rotate', defaults:{m_vRotation:{m_Components:[0,0,0]}}},
  Scale:{_class:'CSmartPropOperation_Scale', defaults:{m_flScale:1}},
  Translate:{_class:'CSmartPropOperation_Translate', defaults:{m_vPosition:{m_Components:[0,0,0]}}},
  SetTintColor:{_class:'CSmartPropOperation_SetTintColor', defaults:{m_Mode:'MULTIPLY_OBJECT',m_ColorChoices:[]}},
  RandomOffset:{_class:'CSmartPropOperation_RandomOffset', defaults:{m_vRandomPositionMin:{m_Components:[0,0,0]},m_vRandomPositionMax:{m_Components:[0,0,0]}}},
  RandomScale:{_class:'CSmartPropOperation_RandomScale', defaults:{m_flRandomScaleMin:0,m_flRandomScaleMax:0}},
  RandomRotation:{_class:'CSmartPropOperation_RandomRotation', defaults:{m_vRandomRotationMin:{m_Components:[0,0,0]},m_vRandomRotationMax:{m_Components:[0,0,0]}}},
  CreateSizer:{_class:'CSmartPropOperation_CreateSizer', defaults:{}},
  CreateRotator:{_class:'CSmartPropOperation_CreateRotator', defaults:{}},
  CreateLocator:{_class:'CSmartPropOperation_CreateLocator', defaults:{}},
  RestoreState:{_class:'CSmartPropOperation_RestoreState', defaults:{m_bDiscardIfUknown:true}},
  TraceInDirection:{_class:'CSmartPropOperation_TraceInDirection', defaults:{m_DirectionSpace:'WORLD',m_flSurfaceUpInfluence:1,m_nNoHitResult:'NOTHING',m_flOriginOffset:-500,m_flTraceLength:500}},
  SaveState:{_class:'CSmartPropOperation_SaveState', defaults:{m_StateName:'State'}},
  SetVariable:{_class:'CSmartPropOperation_SetVariable', defaults:{m_VariableValue:{m_TargetName:null,m_DataType:null,m_Value:null}}},
  RandomRotationSnapped:{_class:'CSmartPropOperation_RandomRotationSnapped', defaults:{m_flSnapIncrement:45.0,m_RotationAxes:'Z'}},
  Comment:{_class:'Hammer5Tools_Comment', defaults:{m_Comment:null}}
};

const FILTER_DEFS = {
  Expression:{_class:'CSmartPropFilter_Expression', defaults:{m_Expression:''}},
  Probability:{_class:'CSmartPropFilter_Probability', defaults:{m_flProbability:1}},
  SurfaceAngle:{_class:'CSmartPropFilter_SurfaceAngle', defaults:{m_flSurfaceSlopeMin:0,m_flSurfaceSlopeMax:0}},
  SurfaceProperties:{_class:'CSmartPropFilter_SurfaceProperties', defaults:{m_AllowedSurfaceProperties:[],m_DisallowedSurfaceProperties:[]}},
  VariableValue:{_class:'CSmartPropFilter_VariableValue', defaults:{m_VariableComparison:{m_Name:'',m_Value:0,m_Comparison:'EQUAL'}}}
};

const SELCRITERIA_DEFS = {
  EndCap:{_class:'CSmartPropSelectionCriteria_EndCap', defaults:{m_bStart:false,m_bEnd:false}},
  ChoiceWeight:{_class:'CSmartPropSelectionCriteria_ChoiceWeight', defaults:{m_flWeight:0}},
  IsValid:{_class:'CSmartPropSelectionCriteria_IsValid', defaults:{}},
  LinearLength:{_class:'CSmartPropSelectionCriteria_LinearLength', defaults:{m_flLength:0,m_bAllowScale:false,m_flMinLength:0,m_flMaxLength:0}},
  PathPosition:{_class:'CSmartPropSelectionCriteria_PathPosition', defaults:{m_PlaceAtPositions:'ALL',m_nPlaceEveryNthPosition:0,m_nNthPositionIndexOffset:0,m_bAllowAtStart:false,m_bAllowAtEnd:false}},
  Comment:{_class:'Hammer5Tools_Comment', defaults:{m_Comment:null}}
};

const VARIABLE_TYPES = ['Bool','Int','Float','String','Vector2D','Vector3D','Vector4D','Color','Angles','Model','MaterialGroup','ApplyColorMode','CoordinateSpace','Direction','DistributionMode','RadiusPlacementMode','ChoiceSelectionMode','TraceNoHit','ScaleMode','PickMode','GridPlacementMode','GridOriginMode','PathPositions'];

// Property display order per class
const PROP_MAP = {
  FitOnLine:['m_nReferenceID','m_bEnabled','m_vStart','m_vEnd','m_PointSpace','m_bOrientAlongLine','m_vUpDirection','m_UpDirectionSpace','m_bPrioritizeUp','m_nScaleMode','m_nPickMode'],
  PickOne:['m_nReferenceID','m_bEnabled','m_SelectionMode','m_SpecificChildIndex','m_OutputChoiceVariableName','m_bConfigurable','m_vHandleOffset','m_HandleColor','m_HandleSize','m_HandleShape'],
  PlaceInSphere:['m_nReferenceID','m_bEnabled','m_nCountMin','m_nCountMax','m_flPositionRadiusInner','m_flPositionRadiusOuter','m_flRandomness','m_bAlignOrientation','m_PlacementMode','m_DistributionMode','m_vAlignDirection','m_vPlaneUpDirection'],
  PlaceOnPath:['m_nReferenceID','m_bEnabled','m_PathName','m_vPathOffset','m_flOffsetAlongPath','m_PathSpace','m_flSpacing','m_SpacingSpace','m_bContinuousSpline','m_DefaultPath','m_bUseFixedUpDirection','m_bUseProjectedDistance','m_UpDirectionSpace','m_vUpDirection'],
  Model:['m_nReferenceID','m_bEnabled','m_sModelName','m_bForceStatic','m_vModelScale','m_MaterialGroupName','m_bDetailObject','m_bRigidDeformation','m_nLodLevel','m_DetailObjectFadeLevel'],
  SmartProp:['m_nReferenceID','m_bEnabled','m_sSmartProp','m_vModelScale'],
  PlaceMultiple:['m_nReferenceID','m_bEnabled','m_nCountMin','m_nCountMax','m_flSpacing','m_PlacementMode','m_bRandomizeOrder'],
  Group:['m_nReferenceID','m_bEnabled'],
  ModifyState:['m_nReferenceID','m_bEnabled'],
  BendDeformer:['m_nReferenceID','m_bEnabled','m_bDeformationEnabled','m_vSize','m_vOrigin','m_vAngles','m_flBendAngle','m_flBendPoint','m_flBendRadius'],
  ModelEntity:['m_nReferenceID','m_bEnabled','m_sModelName','m_vModelScale','m_MaterialGroupName','m_bDetailObject','m_bRigidDeformation','m_nLodLevel','m_DetailObjectFadeLevel'],
  PropPhysics:['m_nReferenceID','m_bEnabled','m_sModelName','m_vModelScale','m_MaterialGroupName','m_flMass','m_bStartAsleep','m_nHealth','m_bEnableMotion'],
  PropDynamic:['m_nReferenceID','m_bEnabled','m_sModelName','m_sAnimationSequence','m_sDefaultAnimation','m_vModelScale','m_MaterialGroupName'],
  MidpointDeformer:['m_nReferenceID','m_bEnabled','m_bDeformationEnabled','m_vStart','m_vEnd','m_fRadius','m_bContinuousSpline','m_vOffset','m_vAngles','m_vScale','m_fFalloff','m_OutputVariable'],
  Layout2DGrid:['m_nReferenceID','m_bEnabled','m_flWidth','m_flLength','m_bVerticalLength','m_GridArrangement','m_GridOriginMode','m_nCountW','m_nCountL','m_flSpacingWidth','m_flSpacingLength','m_bAlternateShift','m_flAlternateShiftWidth','m_flAlternateShiftLength'],
  CreateSizer:['m_bEnabled','m_flInitialMinX','m_flInitialMaxX','m_flConstraintMinX','m_flConstraintMaxX','m_OutputVariableMinX','m_OutputVariableMaxX','m_flInitialMinY','m_flInitialMaxY','m_flConstraintMinY','m_flConstraintMaxY','m_OutputVariableMinY','m_OutputVariableMaxY','m_flInitialMinZ','m_flInitialMaxZ','m_flConstraintMinZ','m_flConstraintMaxZ','m_OutputVariableMinZ','m_OutputVariableMaxZ'],
  CreateRotator:['m_bEnabled','m_vRotationAxis','m_CoordinateSpace','m_flDisplayRadius','m_bApplyToCurrentTransform','m_OutputVariable','m_flSnappingIncrement','m_bEnforceLimits','m_flMinAngle','m_flMaxAngle'],
  CreateLocator:['m_bEnabled','m_flDisplayScale','m_bAllowScale'],
  RestoreState:['m_bEnabled','m_StateName','m_bDiscardIfUknown'],
  RandomRotation:['m_bEnabled','m_vRandomRotationMin','m_vRandomRotationMax'],
  RandomOffset:['m_bEnabled','m_vRandomPositionMin','m_vRandomPositionMax'],
  RandomScale:['m_bEnabled','m_flRandomScaleMin','m_flRandomScaleMax'],
  Scale:['m_bEnabled','m_flScale'],
  Rotate:['m_bEnabled','m_vRotation'],
  Translate:['m_bEnabled','m_vPosition'],
  SetTintColor:['m_bEnabled','m_Mode','m_ColorChoices','m_SelectionMode','m_ColorSelection'],
  SetVariable:['m_bEnabled','m_VariableValue'],
  SurfaceProperties:['m_bEnabled','m_DisallowedSurfaceProperties','m_AllowedSurfaceProperties'],
  VariableValue:['m_bEnabled','m_VariableComparison'],
  SurfaceAngle:['m_bEnabled','m_flSurfaceSlopeMin','m_flSurfaceSlopeMax'],
  PathPosition:['m_bEnabled','m_PlaceAtPositions','m_nPlaceEveryNthPosition','m_nNthPositionIndexOffset','m_bAllowAtStart','m_bAllowAtEnd'],
  EndCap:['m_bEnabled','m_bStart','m_bEnd'],
  LinearLength:['m_bEnabled','m_bAllowScale','m_flLength','m_flMinLength','m_flMaxLength'],
  ChoiceWeight:['m_bEnabled','m_flWeight'],
  TraceInDirection:['m_bEnabled','m_DirectionSpace','m_nNoHitResult','m_flSurfaceUpInfluence','m_flOriginOffset','m_flTraceLength'],
  SaveState:['m_bEnabled','m_StateName'],
  RandomRotationSnapped:['m_bEnabled','m_vMinAngles','m_vMaxAngles','m_flSnapIncrement','m_RotationAxes'],
  Comment:['m_Comment'],
  Expression:['m_bEnabled','m_Expression'],
  Probability:['m_bEnabled','m_flProbability']
};

// Combobox options
const COMBO_OPTIONS = {
  m_nPickMode:['LARGEST_FIRST','RANDOM','ALL_IN_ORDER','SEQUENCE'],
  m_nScaleMode:['NONE','SCALE_END_TO_FIT','SCALE_EQUALLY','SCALE_MAXIMAIZE'],
  m_CoordinateSpace:['ELEMENT','OBJECT','WORLD'],
  m_DirectionSpace:['ELEMENT','OBJECT','WORLD'],
  m_GridArrangement:['SEGMENT','FILL'],
  m_GridOriginMode:['CENTER','CORNER'],
  m_nNoHitResult:['NOTHING','DISCARD','MOVE_TO_START','MOVE_TO_END'],
  m_SelectionMode:['RANDOM','FIRST','SPECIFIC'],
  m_PlacementMode:['SPHERE','CIRCLE','RING'],
  m_DistributionMode:['RANDOM','UNIFORM'],
  m_SpacingSpace:['ELEMENT','OBJECT','WORLD'],
  m_DetailObjectFadeLevel:['NEAR','MEDIUM','FAR','ALWAYS'],
  m_RotationAxes:['X','Y','Z','XY','XZ','YZ','XYZ'],
  m_HandleShape:['SQUARE','DIAMOND','CIRCLE'],
  m_PointSpace:['ELEMENT','OBJECT','WORLD'],
  m_PathSpace:['ELEMENT','OBJECT','WORLD'],
  m_UpDirectionSpace:['ELEMENT','OBJECT','WORLD'],
  m_PlaceAtPositions:['ALL','NTH','START_AND_END','CONTROL_POINTS'],
  m_Mode:['MULTIPLY_OBJECT','MULTIPLY_CURRENT','REPLACE'],
  m_ApplyColorMode:['MULTIPLY_OBJECT','MULTIPLY_CURRENT','REPLACE'],
  m_Comparison:['EQUAL','NOT_EQUAL','LESS_THAN','LESS_OR_EQUAL','GREATER_THAN','GREATER_OR_EQUAL'],
  m_sPhysicsType:['normal','multiplayer']
};

const ELEMENT_ICONS = {
  Group:           ICONS.folder,
  Model:           ICONS.box,
  SmartProp:       ICONS.sparkles,
  PlaceOnPath:     ICONS.route,
  PlaceInSphere:   ICONS.circleDot,
  PlaceMultiple:   ICONS.grid2x2,
  PickOne:         ICONS.shuffle,
  FitOnLine:       ICONS.ruler,
  ModifyState:     ICONS.refreshCw,
  BendDeformer:    ICONS.wave,
  ModelEntity:     ICONS.package,
  PropPhysics:     ICONS.zap,
  PropDynamic:     ICONS.playCircle,
  MidpointDeformer:ICONS.gitCommit,
  Layout2DGrid:    ICONS.layoutGrid
};

// ===== UTILITY =====
function prettify(name) {
  let s = name.replace(/^m_fl|^m_n|^m_b|^m_s|^m_v|^m_f|^m_/, '');
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function getClassName(node) {
  if (!node || !node._class) return '';
  return node._class.split('_').pop() || node._class.replace(/^CSmartProp(Element|Operation|Filter|SelectionCriteria|Variable)_/, '');
}

function getShortClass(cls) {
  if (!cls) return '';
  const parts = cls.split('_');
  return parts[parts.length - 1] || cls;
}

function getElementIcon(shortClass) {
  return ELEMENT_ICONS[shortClass] || ICONS.box;
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function genId() { return nextElementId++; }

function recalcMaxId(node) {
  if (!node) return;
  if (node.m_nElementID != null && node.m_nElementID >= nextElementId) nextElementId = node.m_nElementID + 1;
  if (node.m_Children) node.m_Children.forEach(recalcMaxId);
  if (node.m_Modifiers) node.m_Modifiers.forEach(recalcMaxId);
  if (node.m_SelectionCriteria) node.m_SelectionCriteria.forEach(recalcMaxId);
}

function recalcAllIds() {
  nextElementId = 1;
  doc.m_Children.forEach(recalcMaxId);
  doc.m_Variables.forEach(recalcMaxId);
}

// ===== UNDO/REDO =====
function captureEditorState() {
  return JSON.stringify({
    doc,
    selectedNodePath,
    expandedNodes: Array.from(expandedNodes)
  });
}

// Apply a snapshot without triggering a full render (used for bulk jumps).
function applyState(snapshot) {
  const state = JSON.parse(snapshot);
  if (state && state.doc) {
    doc = state.doc;
    selectedNodePath = state.selectedNodePath || null;
    expandedNodes = new Set(state.expandedNodes || ['root', 'children', 'variables']);
  } else {
    doc = state;
    selectedNodePath = null;
    expandedNodes = new Set(['root', 'children', 'variables']);
  }
  recalcAllIds();
  if (selectedNodePath && !resolveNode(selectedNodePath)) selectedNodePath = null;
}

function restoreEditorState(snapshot) {
  applyState(snapshot);
  renderAll();
}

// Each stack entry: { snapshot: string, label: string }
function pushUndo(label = 'Edit') {
  // During a slider drag, only record the state at the very start of the drag.
  if (sliderDragging) {
    if (sliderDragUndoPushed) return;
    sliderDragUndoPushed = true;
    label = 'Edit Property';
  }
  undoStack.push({ snapshot: captureEditorState(), label });
  if (undoStack.length > maxUndo) undoStack.shift();
  redoStack = [];
}
function undo() {
  if (!undoStack.length) return;
  const entry = undoStack.pop();
  redoStack.push({ snapshot: captureEditorState(), label: entry.label });
  applyState(entry.snapshot);
  renderAll();
}
function redo() {
  if (!redoStack.length) return;
  const entry = redoStack.pop();
  undoStack.push({ snapshot: captureEditorState(), label: entry.label });
  applyState(entry.snapshot);
  renderAll();
}

// Jump directly to any position in history without repeated full renders.
// index = 0 → oldest undo state; index = undoStack.length → current state.
function jumpToHistoryState(targetIndex) {
  const currentIndex = undoStack.length;
  if (targetIndex === currentIndex) return;
  if (targetIndex < currentIndex) {
    const steps = currentIndex - targetIndex;
    for (let i = 0; i < steps; i++) {
      if (!undoStack.length) break;
      const entry = undoStack.pop();
      redoStack.push({ snapshot: captureEditorState(), label: entry.label });
      applyState(entry.snapshot);
    }
  } else {
    const steps = targetIndex - currentIndex;
    for (let i = 0; i < steps; i++) {
      if (!redoStack.length) break;
      const entry = redoStack.pop();
      undoStack.push({ snapshot: captureEditorState(), label: entry.label });
      applyState(entry.snapshot);
    }
  }
  renderAll();
}

// ===== NODE RESOLUTION =====
// Path format: "children.0" or "children.0.m_Modifiers.1" or "variables.2"
function resolveNode(path) {
  if (!path) return null;
  const parts = path.split('.');
  let current = doc;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === 'children') { current = current.m_Children; }
    else if (p === 'variables') { current = current.m_Variables; }
    else if (p === 'm_Modifiers' || p === 'm_SelectionCriteria' || p === 'm_Children') {
      current = current[p];
    }
    else {
      const idx = parseInt(p);
      if (!Array.isArray(current) || idx < 0 || idx >= current.length) return null;
      current = current[idx];
    }
  }
  return current;
}

function resolveParentArray(path) {
  if (!path) return null;
  const parts = path.split('.');
  const idx = parseInt(parts[parts.length - 1]);
  const parentPath = parts.slice(0, -1).join('.');
  let arr;
  if (parentPath === 'children') arr = doc.m_Children;
  else if (parentPath === 'variables') arr = doc.m_Variables;
  else arr = resolveNode(parentPath);
  if (!Array.isArray(arr)) return null;
  return { arr, idx };
}

// ===== CREATE NODES =====
function createElement(typeName) {
  const def = ELEMENT_DEFS[typeName];
  if (!def) return null;
  const node = { _class: def._class, m_nElementID: genId(), ...deepClone(def.defaults), m_Modifiers: [], m_SelectionCriteria: [] };
  if (def.hasChildren || CHILD_ELEMENTS.has(def._class)) node.m_Children = [];
  if (!('m_bEnabled' in node)) node.m_bEnabled = true;
  return node;
}

function createOperator(typeName) {
  const def = OPERATOR_DEFS[typeName];
  if (!def) return null;
  return { _class: def._class, m_nElementID: genId(), m_bEnabled: true, ...deepClone(def.defaults) };
}

function createFilter(typeName) {
  const def = FILTER_DEFS[typeName];
  if (!def) return null;
  return { _class: def._class, m_nElementID: genId(), m_bEnabled: true, ...deepClone(def.defaults) };
}

function createSelCriteria(typeName) {
  const def = SELCRITERIA_DEFS[typeName];
  if (!def) return null;
  return { _class: def._class, m_nElementID: genId(), m_bEnabled: true, ...deepClone(def.defaults) };
}

function createVariable(typeName) {
  const prefix = 'CSmartPropVariable_';
  return { _class: prefix + typeName, m_VariableName: 'new_variable', m_bExposeAsParameter: true, m_DefaultValue: getDefaultForVarType(typeName), m_nElementID: genId(), m_ParameterName: 'New Variable' };
}

function getDefaultForVarType(t) {
  if (t === 'Bool') return false;
  if (t === 'Int') return 0;
  if (t === 'Float') return 0;
  if (t === 'String' || t === 'Model' || t === 'MaterialGroup') return '';
  if (t === 'Vector2D') return [0, 0];
  if (t === 'Vector3D' || t === 'Color' || t === 'Angles') return [0, 0, 0];
  if (t === 'Vector4D') return [0, 0, 0, 0];
  return '';
}

// ===== UNDO HISTORY PANEL =====
function renderUndoHistory() {
  const list = document.getElementById('undoHistoryList');
  if (!list) return;
  list.innerHTML = '';

  // Build the full timeline: [oldest undo ... newest undo] [current] [oldest redo ... newest redo]
  // undoStack[0] = oldest pre-action state, undoStack[N-1] = most recent pre-action state
  // We show entries newest-first (current at top).
  const currentIndex = undoStack.length; // position of "current" in the flattened list

  function makeEntry(label, index, isCurrent, isRedo) {
    const el = document.createElement('div');
    el.className = 'history-entry' + (isCurrent ? ' history-current' : '') + (isRedo ? ' history-redo' : '');
    const icon = isCurrent ? ICONS.playSolid : (isRedo ? ICONS.rotateCw : ICONS.rotateCcw);
    el.innerHTML = `<span class="history-icon">${icon}</span><span class="history-label">${escHtml(label)}</span>`;
    if (!isCurrent) {
      el.title = isRedo ? 'Redo to this state' : 'Undo to this state';
      el.addEventListener('click', () => jumpToHistoryState(index));
    }
    return el;
  }

  // Redo entries (above current, newest redo at top = redoStack[0])
  for (let i = 0; i < redoStack.length; i++) {
    list.appendChild(makeEntry(redoStack[i].label, currentIndex + (redoStack.length - i), false, true));
  }

  // Current state
  list.appendChild(makeEntry('Current', currentIndex, true, false));

  // Undo entries (below current, most recent undo first = undoStack[N-1])
  for (let i = undoStack.length - 1; i >= 0; i--) {
    list.appendChild(makeEntry(undoStack[i].label, i, false, false));
  }
}

// ===== TREE RENDERING =====
function renderAll() {
  renderTree();
  renderProperties();
  updatePreview();
  updateStatus();
  renderUndoHistory();
}

function renderTree() {
  const tree = document.getElementById('tree');
  tree.innerHTML = '';
  // Children section
  const childHeader = createTreeSection('children', ICONS.layers, 'Children', doc.m_Children.length);
  tree.appendChild(childHeader.row);
  if (expandedNodes.has('children')) {
    doc.m_Children.forEach((child, i) => {
      renderTreeNode(tree, child, `children.${i}`, 1);
    });
  }
  // Variables section
  const varHeader = createTreeSection('variables', ICONS.braces, 'Variables', doc.m_Variables.length);
  tree.appendChild(varHeader.row);
  if (expandedNodes.has('variables')) {
    doc.m_Variables.forEach((v, i) => {
      const row = document.createElement('div');
      row.className = 'tree-item-row' + (selectedNodePath === `variables.${i}` ? ' selected' : '');
      row.style.paddingLeft = (16 + 8) + 'px';
      row.dataset.path = `variables.${i}`;
      row.draggable = true;
      const varType = getShortClass(v._class);
      row.innerHTML = `<span class="tree-toggle empty">${ICONS.chevronRight}</span><span class="tree-icon">${ICONS.tag}</span><span class="tree-label">${v.m_VariableName || 'unnamed'}</span><span class="tree-badge" style="background:rgba(137,180,250,.1);color:var(--accent);font-size:9px">${varType}</span>`;
      row.addEventListener('click', (e) => { e.stopPropagation(); selectNode(`variables.${i}`); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showVariableContextMenu(e, `variables.${i}`); });
      setupDragDrop(row, `variables.${i}`);
      tree.appendChild(row);
    });
  }
}

function createTreeSection(id, icon, label, count) {
  const row = document.createElement('div');
  row.className = 'tree-item-row';
  row.style.paddingLeft = '8px';
  row.style.fontWeight = '600';
  row.style.color = 'var(--text-secondary)';
  const expanded = expandedNodes.has(id);
  row.innerHTML = `<span class="tree-toggle ${expanded ? 'expanded' : ''}" data-toggle="${id}">${ICONS.chevronRight}</span><span class="tree-icon">${icon}</span><span class="tree-label">${label} (${count})</span>`;
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand(id);
  });
  return { row };
}

function renderTreeNode(container, node, path, depth) {
  const shortClass = getShortClass(node._class);
  const hasChildren = node.m_Children && node.m_Children.length > 0;
  const hasMods = showModifiersInTree && node.m_Modifiers && node.m_Modifiers.length > 0;
  const hasCriteria = showSelectionCriteriaInTree && node.m_SelectionCriteria && node.m_SelectionCriteria.length > 0;
  const hasSubItems = hasChildren || hasMods || hasCriteria || (node.m_Children !== undefined) || (showModifiersInTree && node.m_Modifiers !== undefined) || (showSelectionCriteriaInTree && node.m_SelectionCriteria !== undefined);
  const expanded = expandedNodes.has(path);
  const label = node.m_sLabel || shortClass;
  const icon = getElementIcon(shortClass);
  const isSelected = selectedNodePath === path;

  const row = document.createElement('div');
  row.className = 'tree-item-row' + (isSelected ? ' selected' : '');
  row.style.paddingLeft = (depth * 16 + 8) + 'px';
  row.dataset.path = path;
  row.draggable = true;
  row.innerHTML = `<span class="tree-toggle ${hasSubItems ? (expanded ? 'expanded' : '') : 'empty'}" data-toggle="${path}">${ICONS.chevronRight}</span><span class="tree-icon">${icon}</span><span class="tree-label">${escHtml(label)}</span>${label !== shortClass ? `<span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono)">${shortClass}</span>` : ''}`;

  row.addEventListener('click', (e) => { e.stopPropagation(); selectNode(path); });
  row.querySelector('.tree-toggle').addEventListener('click', (e) => { e.stopPropagation(); toggleExpand(path); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showElementContextMenu(e, path); });
  row.addEventListener('dblclick', (e) => { e.stopPropagation(); const freshRow = document.querySelector(`[data-path="${path}"]`); if (freshRow) startRename(path, freshRow); });
  setupDragDrop(row, path);
  container.appendChild(row);

  if (expanded) {
    // Modifiers
    if (showModifiersInTree && node.m_Modifiers) {
      if (node.m_Modifiers.length > 0 || true) { // always show section
        const modSectionId = path + '.m_Modifiers';
        const modExpanded = expandedNodes.has(modSectionId);
        const modRow = document.createElement('div');
        modRow.className = 'tree-item-row';
        modRow.style.paddingLeft = ((depth + 1) * 16 + 8) + 'px';
        modRow.style.color = 'var(--mauve)';
        modRow.style.fontSize = '11px';
        modRow.innerHTML = `<span class="tree-toggle ${node.m_Modifiers.length > 0 ? (modExpanded ? 'expanded' : '') : 'empty'}" data-toggle="${modSectionId}">${ICONS.chevronRight}</span><span class="tree-icon">${ICONS.sliders}</span><span class="tree-label">Modifiers (${node.m_Modifiers.length})</span>`;
        modRow.addEventListener('click', (e) => { e.stopPropagation(); toggleExpand(modSectionId); });
        modRow.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showAddModifierMenu(e, path); });
        container.appendChild(modRow);
        if (modExpanded) {
          node.m_Modifiers.forEach((mod, mi) => {
            const modPath = `${path}.m_Modifiers.${mi}`;
            const modClass = getShortClass(mod._class);
            const mRow = document.createElement('div');
            mRow.className = 'tree-item-row' + (selectedNodePath === modPath ? ' selected' : '');
            mRow.style.paddingLeft = ((depth + 2) * 16 + 8) + 'px';
            mRow.dataset.path = modPath;
            mRow.draggable = true;
            mRow.innerHTML = `<span class="tree-toggle empty">${ICONS.chevronRight}</span><span class="tree-icon">${ICONS.wrench}</span><span class="tree-label">${modClass}</span><span class="tree-badge modifier">mod</span>`;
            mRow.addEventListener('click', (e) => { e.stopPropagation(); selectNode(modPath); });
            mRow.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showModifierContextMenu(e, modPath, path); });
            setupDragDrop(mRow, modPath);
            container.appendChild(mRow);
          });
        }
      }
    }
    // Selection Criteria
    if (showSelectionCriteriaInTree && node.m_SelectionCriteria) {
      const scSectionId = path + '.m_SelectionCriteria';
      const scExpanded = expandedNodes.has(scSectionId);
      const scRow = document.createElement('div');
      scRow.className = 'tree-item-row';
      scRow.style.paddingLeft = ((depth + 1) * 16 + 8) + 'px';
      scRow.style.color = 'var(--yellow)';
      scRow.style.fontSize = '11px';
      scRow.innerHTML = `<span class="tree-toggle ${node.m_SelectionCriteria.length > 0 ? (scExpanded ? 'expanded' : '') : 'empty'}" data-toggle="${scSectionId}">${ICONS.chevronRight}</span><span class="tree-icon">${ICONS.filter}</span><span class="tree-label">Selection Criteria (${node.m_SelectionCriteria.length})</span>`;
      scRow.addEventListener('click', (e) => { e.stopPropagation(); toggleExpand(scSectionId); });
      scRow.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showAddCriteriaMenu(e, path); });
      container.appendChild(scRow);
      if (scExpanded) {
        node.m_SelectionCriteria.forEach((sc, si) => {
          const scPath = `${path}.m_SelectionCriteria.${si}`;
          const scClass = getShortClass(sc._class);
          const sRow = document.createElement('div');
          sRow.className = 'tree-item-row' + (selectedNodePath === scPath ? ' selected' : '');
          sRow.style.paddingLeft = ((depth + 2) * 16 + 8) + 'px';
          sRow.dataset.path = scPath;
          sRow.draggable = true;
          sRow.innerHTML = `<span class="tree-toggle empty">${ICONS.chevronRight}</span><span class="tree-icon">${ICONS.target}</span><span class="tree-label">${scClass}</span><span class="tree-badge criteria">crit</span>`;
          sRow.addEventListener('click', (e) => { e.stopPropagation(); selectNode(scPath); });
          sRow.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showModifierContextMenu(e, scPath, path); });
          setupDragDrop(sRow, scPath);
          container.appendChild(sRow);
        });
      }
    }
    // Children
    if (node.m_Children) {
      node.m_Children.forEach((child, ci) => {
        renderTreeNode(container, child, `${path}.m_Children.${ci}`, depth + 1);
      });
    }
  }
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function toggleExpand(id) {
  if (expandedNodes.has(id)) expandedNodes.delete(id);
  else expandedNodes.add(id);
  renderTree();
}

function collapseAllTree() { expandedNodes.clear(); expandedNodes.add('children'); expandedNodes.add('variables'); renderTree(); }

function toggleShowModifiers() {
  showModifiersInTree = !showModifiersInTree;
  document.getElementById('btnToggleModifiers').classList.toggle('active', showModifiersInTree);
  renderTree();
}
function toggleShowCriteria() {
  showSelectionCriteriaInTree = !showSelectionCriteriaInTree;
  document.getElementById('btnToggleCriteria').classList.toggle('active', showSelectionCriteriaInTree);
  renderTree();
}
function expandAllTree() {
  expandedNodes.add('children'); expandedNodes.add('variables');
  function expandAll(node, path) {
    expandedNodes.add(path);
    if (node.m_Modifiers && node.m_Modifiers.length) expandedNodes.add(path + '.m_Modifiers');
    if (node.m_SelectionCriteria && node.m_SelectionCriteria.length) expandedNodes.add(path + '.m_SelectionCriteria');
    if (node.m_Children) node.m_Children.forEach((c, i) => expandAll(c, `${path}.m_Children.${i}`));
  }
  doc.m_Children.forEach((c, i) => expandAll(c, `children.${i}`));
  renderTree();
}

function selectNode(path) {
  selectedNodePath = path;
  renderTree();
  renderProperties();
}

// ===== DRAG & DROP =====
let dragPath = null;
function setupDragDrop(row, path) {
  row.addEventListener('dragstart', (e) => {
    dragPath = path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
    row.style.opacity = '0.5';
  });
  row.addEventListener('dragend', () => { dragPath = null; row.style.opacity = ''; clearDragClasses(); });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDragClasses();
    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y < h * 0.25) row.classList.add('drag-over-above');
    else if (y > h * 0.75) row.classList.add('drag-over-below');
    else row.classList.add('drag-over-inside');
  });
  row.addEventListener('dragleave', () => { row.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside'); });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDragClasses();
    const srcPath = e.dataTransfer.getData('text/plain');
    const dstPath = path;
    if (!srcPath || srcPath === dstPath) return;
    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    let position;
    if (y < h * 0.25) position = 'above';
    else if (y > h * 0.75) position = 'below';
    else position = 'inside';
    performDrop(srcPath, dstPath, position);
  });
}

function clearDragClasses() {
  document.querySelectorAll('.drag-over-above,.drag-over-below,.drag-over-inside').forEach(el => {
    el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });
}

function performDrop(srcPath, dstPath, position) {
  // Only allow reorder within same parent array, or reparent into a compatible container
  const srcParent = resolveParentArray(srcPath);
  if (!srcParent) return;
  pushUndo('Move (Drag)');
  const node = deepClone(srcParent.arr[srcParent.idx]);
  srcParent.arr.splice(srcParent.idx, 1);

  // Fix paths after removal
  if (position === 'inside') {
    const dstNode = resolveNode(dstPath);
    if (!dstNode) { renderAll(); return; }
    // Determine which array to add to
    if (srcPath.includes('.m_Modifiers.') && dstNode.m_Modifiers) {
      dstNode.m_Modifiers.push(node);
    } else if (srcPath.includes('.m_SelectionCriteria.') && dstNode.m_SelectionCriteria) {
      dstNode.m_SelectionCriteria.push(node);
    } else if (dstNode.m_Children !== undefined) {
      dstNode.m_Children.push(node);
      expandedNodes.add(dstPath);
    } else {
      // Can't drop here, put it back
      srcParent.arr.splice(srcParent.idx, 0, node);
    }
  } else {
    // Recalculate dstParent after removal
    const dstParent = resolveParentArray(dstPath);
    if (!dstParent) { srcParent.arr.splice(srcParent.idx, 0, node); renderAll(); return; }
    const insertIdx = position === 'above' ? dstParent.idx : dstParent.idx + 1;
    dstParent.arr.splice(insertIdx, 0, node);
  }
  renderAll();
}

// ===== CONTEXT MENUS =====
let activeMenu = null;
function closeMenus() {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
}
document.addEventListener('mousedown', (e) => {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenus();
});

function showMenu(x, y, items) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  items.forEach(item => {
    if (item === '---') { const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep); return; }
    if (item.header) { const h = document.createElement('div'); h.className = 'ctx-header'; h.textContent = item.header; menu.appendChild(h); return; }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.innerHTML = `<span class="ctx-content">${item.icon ? `<span class="ctx-icon">${item.icon}</span>` : '<span class="ctx-icon ctx-icon-placeholder"></span>'}<span class="ctx-label">${item.label}</span></span>${item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : ''}`;
    el.addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); item.action(); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  // Position
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 4;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  activeMenu = menu;
}

function showElementContextMenu(e, path) {
  const node = resolveNode(path);
  if (!node) return;
  const canHaveChildren = node.m_Children !== undefined;
  const items = [];
  if (canHaveChildren) {
    items.push({ icon: ICONS.plusSquare, label: 'Add Child Element...', action: () => showElementPicker(e.clientX, e.clientY, (typeName) => { pushUndo('Add Element'); node.m_Children.push(createElement(typeName)); expandedNodes.add(path); renderAll(); }) });
  }
  items.push({ icon: ICONS.wrench,    label: 'Add Modifier...',           action: () => showOperatorPicker(e.clientX, e.clientY, path) });
  items.push({ icon: ICONS.target,    label: 'Add Selection Criteria...', action: () => showCriteriaPicker(e.clientX, e.clientY, path) });
  items.push('---');
  items.push({ icon: ICONS.copy,      label: 'Copy',      shortcut: 'Ctrl+C', action: () => copyNode(path) });
  items.push({ icon: ICONS.scissors,  label: 'Cut',       shortcut: 'Ctrl+X', action: () => cutNode(path) });
  if (clipboard) items.push({ icon: ICONS.clipboard, label: 'Paste', shortcut: 'Ctrl+V', action: () => pasteNode(path) });
  items.push('---');
  items.push({ icon: ICONS.duplicate, label: 'Duplicate', shortcut: 'Ctrl+D', action: () => duplicateNode(path) });
  items.push({ icon: ICONS.pencil,    label: 'Rename',    action: () => { const row = document.querySelector(`[data-path="${path}"]`); if (row) startRename(path, row); } });
  items.push('---');
  items.push({ icon: ICONS.arrowUp,   label: 'Move Up',   action: () => moveNode(path, -1) });
  items.push({ icon: ICONS.arrowDown, label: 'Move Down', action: () => moveNode(path, 1) });
  items.push('---');
  items.push({ icon: ICONS.trash,     label: 'Delete',    shortcut: 'Del', danger: true, action: () => deleteNode(path) });
  showMenu(e.clientX, e.clientY, items);
}

function showVariableContextMenu(e, path) {
  const items = [
    { icon: ICONS.duplicate, label: 'Duplicate', shortcut: 'Ctrl+D', action: () => duplicateNode(path) },
    '---',
    { icon: ICONS.arrowUp,   label: 'Move Up',   action: () => moveNode(path, -1) },
    { icon: ICONS.arrowDown, label: 'Move Down', action: () => moveNode(path, 1) },
    '---',
    { icon: ICONS.trash,     label: 'Delete',    shortcut: 'Del', danger: true, action: () => deleteNode(path) }
  ];
  showMenu(e.clientX, e.clientY, items);
}

function showModifierContextMenu(e, modPath, _parentPath) {
  const items = [
    { icon: ICONS.copy,      label: 'Copy',      action: () => copyNode(modPath) },
    { icon: ICONS.duplicate, label: 'Duplicate', action: () => duplicateNode(modPath) },
    '---',
    { icon: ICONS.arrowUp,   label: 'Move Up',   action: () => moveNode(modPath, -1) },
    { icon: ICONS.arrowDown, label: 'Move Down', action: () => moveNode(modPath, 1) },
    '---',
    { icon: ICONS.trash,     label: 'Delete',    danger: true, action: () => deleteNode(modPath) }
  ];
  showMenu(e.clientX, e.clientY, items);
}

function showAddModifierMenu(e, parentPath) {
  const items = [
    { header: 'Add Modifier' },
    ...Object.keys(OPERATOR_DEFS).map(name => ({
      label: name, action: () => { pushUndo('Add Modifier'); const node = resolveNode(parentPath); if (node && node.m_Modifiers) { node.m_Modifiers.push(createOperator(name)); expandedNodes.add(parentPath + '.m_Modifiers'); renderAll(); } }
    })),
    '---',
    { header: 'Add Filter' },
    ...Object.keys(FILTER_DEFS).map(name => ({
      label: name, action: () => { pushUndo('Add Filter'); const node = resolveNode(parentPath); if (node && node.m_Modifiers) { node.m_Modifiers.push(createFilter(name)); expandedNodes.add(parentPath + '.m_Modifiers'); renderAll(); } }
    }))
  ];
  showMenu(e.clientX, e.clientY, items);
}

function showAddCriteriaMenu(e, parentPath) {
  const items = [
    { header: 'Add Selection Criteria' },
    ...Object.keys(SELCRITERIA_DEFS).map(name => ({
      label: name, action: () => { pushUndo('Add Criteria'); const node = resolveNode(parentPath); if (node && node.m_SelectionCriteria) { node.m_SelectionCriteria.push(createSelCriteria(name)); expandedNodes.add(parentPath + '.m_SelectionCriteria'); renderAll(); } }
    }))
  ];
  showMenu(e.clientX, e.clientY, items);
}

// ===== ELEMENT/OPERATOR PICKERS =====
function showElementPicker(x, y, callback) {
  const items = Object.keys(ELEMENT_DEFS).map(name => ({
    icon: getElementIcon(name), label: name, action: () => callback(name)
  }));
  showMenu(x, y, [{ header: 'Add Element' }, ...items]);
}

function showOperatorPicker(x, y, parentPath) {
  const items = [
    { header: 'Modifiers' },
    ...Object.keys(OPERATOR_DEFS).map(name => ({
      label: name, action: () => { pushUndo('Add Modifier'); const node = resolveNode(parentPath); if (node) { if (!node.m_Modifiers) node.m_Modifiers = []; node.m_Modifiers.push(createOperator(name)); expandedNodes.add(parentPath + '.m_Modifiers'); renderAll(); } }
    })),
    '---',
    { header: 'Filters' },
    ...Object.keys(FILTER_DEFS).map(name => ({
      label: name, action: () => { pushUndo('Add Filter'); const node = resolveNode(parentPath); if (node) { if (!node.m_Modifiers) node.m_Modifiers = []; node.m_Modifiers.push(createFilter(name)); expandedNodes.add(parentPath + '.m_Modifiers'); renderAll(); } }
    }))
  ];
  showMenu(x, y, items);
}

function showCriteriaPicker(x, y, parentPath) {
  showAddCriteriaMenu({ clientX: x, clientY: y }, parentPath);
}

// ===== NODE OPERATIONS =====
function deleteNode(path) {
  const pa = resolveParentArray(path);
  if (!pa) return;
  pushUndo('Delete');
  pa.arr.splice(pa.idx, 1);
  if (selectedNodePath === path) selectedNodePath = null;
  renderAll();
}

function duplicateNode(path) {
  const pa = resolveParentArray(path);
  if (!pa) return;
  pushUndo('Duplicate');
  const clone = deepClone(pa.arr[pa.idx]);
  // Reassign IDs
  function reassignIds(n) {
    if (n && typeof n === 'object') {
      if ('m_nElementID' in n) n.m_nElementID = genId();
      if (n.m_Children) n.m_Children.forEach(reassignIds);
      if (n.m_Modifiers) n.m_Modifiers.forEach(reassignIds);
      if (n.m_SelectionCriteria) n.m_SelectionCriteria.forEach(reassignIds);
    }
  }
  reassignIds(clone);
  if (clone.m_sLabel) clone.m_sLabel = clone.m_sLabel + '_copy';
  pa.arr.splice(pa.idx + 1, 0, clone);
  renderAll();
}

function moveNode(path, direction) {
  const pa = resolveParentArray(path);
  if (!pa) return;
  const newIdx = pa.idx + direction;
  if (newIdx < 0 || newIdx >= pa.arr.length) return;
  pushUndo('Move');
  const item = pa.arr.splice(pa.idx, 1)[0];
  pa.arr.splice(newIdx, 0, item);
  // Update selectedNodePath to reflect new index
  const parts = path.split('.');
  parts[parts.length - 1] = String(newIdx);
  selectedNodePath = parts.join('.');
  renderAll();
}

function copyNode(path) {
  const node = resolveNode(path);
  if (node) clipboard = deepClone(node);
}

function cutNode(path) {
  copyNode(path);
  deleteNode(path);
}

function pasteNode(path) {
  if (!clipboard) return;
  const node = resolveNode(path);
  if (!node) return;
  pushUndo('Paste');
  const clone = deepClone(clipboard);
  function reassignIds(n) {
    if (n && typeof n === 'object') {
      if ('m_nElementID' in n) n.m_nElementID = genId();
      if (n.m_Children) n.m_Children.forEach(reassignIds);
      if (n.m_Modifiers) n.m_Modifiers.forEach(reassignIds);
      if (n.m_SelectionCriteria) n.m_SelectionCriteria.forEach(reassignIds);
    }
  }
  reassignIds(clone);
  // Determine where to paste
  if (clone._class && clone._class.includes('Operation') || clone._class && clone._class.includes('Filter')) {
    if (node.m_Modifiers) { node.m_Modifiers.push(clone); expandedNodes.add(path + '.m_Modifiers'); }
  } else if (clone._class && clone._class.includes('SelectionCriteria')) {
    if (node.m_SelectionCriteria) { node.m_SelectionCriteria.push(clone); expandedNodes.add(path + '.m_SelectionCriteria'); }
  } else if (node.m_Children !== undefined) {
    node.m_Children.push(clone);
    expandedNodes.add(path);
  } else {
    // Paste as sibling
    const pa = resolveParentArray(path);
    if (pa) pa.arr.splice(pa.idx + 1, 0, clone);
  }
  renderAll();
}

function startRename(path, row) {
  const node = resolveNode(path);
  if (!node) return;
  const labelEl = row.querySelector('.tree-label');
  if (!labelEl) return;
  const current = node.m_sLabel || node.m_VariableName || getShortClass(node._class);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tree-label-input';
  input.value = current;
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  function finish() {
    pushUndo('Rename');
    const val = input.value.trim();
    if (path.startsWith('variables')) {
      node.m_VariableName = val || 'unnamed';
    } else {
      node.m_sLabel = val || undefined;
    }
    renderAll();
  }
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { input.value = current; input.blur(); } });
}

// ===== SEARCH / FILTER =====
function filterTree(query) {
  const q = query.toLowerCase().trim();
  const rows = document.querySelectorAll('#tree .tree-item-row');
  if (!q) { rows.forEach(r => r.classList.remove('hidden-by-search')); return; }
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    if (text.includes(q)) r.classList.remove('hidden-by-search');
    else r.classList.add('hidden-by-search');
  });
}

// ===== PROPERTIES PANEL =====
function showEmptyProps(container) {
  container.innerHTML = `<div class="empty-state" id="propsEmpty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 13h4"/></svg><div>Select an item to edit</div></div>`;
}
function renderProperties() {
  const container = document.getElementById('propsContainer');
  if (!selectedNodePath) { showEmptyProps(container); return; }
  const node = resolveNode(selectedNodePath);
  if (!node) { showEmptyProps(container); return; }
  container.innerHTML = '';
  const shortClass = getShortClass(node._class);

  // Variable editing
  if (selectedNodePath.startsWith('variables')) {
    renderVariableProps(container, node, selectedNodePath);
    return;
  }

  // Element/modifier/criteria properties
  const propKeys = PROP_MAP[shortClass];
  const isElement = selectedNodePath.match(/^children(\.\d+(.m_Children\.\d+)*)?$/);

  // Section: Properties
  const propsSection = createSection('Element Properties', true);
  container.appendChild(propsSection.el);

  if (propKeys) {
    propKeys.forEach(key => {
      if (key === 'm_nElementID' || key === 'm_sLabel' || key === 'm_sReferenceObjectID') return;
      const val = node[key] !== undefined ? node[key] : null;
      propsSection.body.appendChild(createPropertyWidget(key, val, (newVal) => {
        pushUndo('Edit Property');
        if (newVal === null || newVal === undefined) delete node[key];
        else node[key] = newVal;
        updatePreview();
      }));
    });
  } else {
    // Fallback: show all properties
    Object.keys(node).forEach(key => {
      if (key === '_class' || key === 'm_nElementID' || key === 'm_Children' || key === 'm_Modifiers' || key === 'm_SelectionCriteria' || key === 'm_sLabel') return;
      const val = node[key];
      propsSection.body.appendChild(createPropertyWidget(key, val, (newVal) => {
        pushUndo('Edit Property');
        if (newVal === null || newVal === undefined) delete node[key];
        else node[key] = newVal;
        updatePreview();
      }));
    });
  }

  // Modifiers section (only for elements)
  if (isElement && node.m_Modifiers !== undefined) {
    const modSection = createSection(`Modifiers (${node.m_Modifiers.length})`, true, () => {
      showOperatorPicker(window.innerWidth / 2, window.innerHeight / 2, selectedNodePath);
    });
    container.appendChild(modSection.el);
    node.m_Modifiers.forEach((mod, mi) => {
      modSection.body.appendChild(createModifierFrame(mod, mi, selectedNodePath, 'm_Modifiers'));
    });
  }

  // Selection Criteria section
  if (isElement && node.m_SelectionCriteria !== undefined) {
    const scSection = createSection(`Selection Criteria (${node.m_SelectionCriteria.length})`, true, () => {
      showCriteriaPicker(window.innerWidth / 2, window.innerHeight / 2, selectedNodePath);
    });
    container.appendChild(scSection.el);
    node.m_SelectionCriteria.forEach((sc, si) => {
      scSection.body.appendChild(createModifierFrame(sc, si, selectedNodePath, 'm_SelectionCriteria'));
    });
  }
}

function renderVariableProps(container, node, _path) {
  const section = createSection('Variable Properties', true);
  container.appendChild(section.el);

  const varType = getShortClass(node._class);

  // Variable name
  section.body.appendChild(createPropertyWidget('m_VariableName', node.m_VariableName || '', (v) => { pushUndo('Rename Variable'); node.m_VariableName = v; renderTree(); updatePreview(); }, undefined, true));
  // Parameter name
  section.body.appendChild(createPropertyWidget('m_ParameterName', node.m_ParameterName || '', (v) => { pushUndo('Edit Variable'); node.m_ParameterName = v; updatePreview(); }, undefined, true));
  // Expose as parameter
  section.body.appendChild(createPropertyWidget('m_bExposeAsParameter', node.m_bExposeAsParameter !== false, (v) => { pushUndo('Edit Variable'); node.m_bExposeAsParameter = v; updatePreview(); }, undefined, true));
  // Default value - type depends on variable type
  section.body.appendChild(createPropertyWidget('m_DefaultValue', node.m_DefaultValue, (v) => { pushUndo('Edit Variable'); node.m_DefaultValue = v; updatePreview(); }, varType, true));
  // Type display (read-only)
  const typeRow = document.createElement('div');
  typeRow.className = 'prop-row';
  typeRow.innerHTML = `<span class="prop-label" style="color:var(--text-muted)">Type</span><div class="prop-value"><span style="font-family:var(--font-mono);font-size:12px;color:var(--accent)">${varType}</span></div>`;
  section.body.appendChild(typeRow);
}

function createSection(title, initialOpen, addCallback) {
  const el = document.createElement('div');
  el.className = 'props-section';
  const header = document.createElement('div');
  header.className = 'props-section-header';
  let open = initialOpen !== false;
  header.innerHTML = `<span><span class="toggle ${open ? '' : 'collapsed'}">${ICONS.chevronDown}</span> ${escHtml(title)}</span>${addCallback ? `<button class="btn btn-sm btn-icon" title="Add">${ICONS.plus}</button>` : ''}`;
  const body = document.createElement('div');
  body.className = 'props-section-body' + (open ? '' : ' collapsed');
  header.querySelector('.toggle').parentElement.addEventListener('click', () => {
    open = !open;
    header.querySelector('.toggle').className = 'toggle' + (open ? '' : ' collapsed');
    body.className = 'props-section-body' + (open ? '' : ' collapsed');
  });
  if (addCallback) {
    header.querySelector('button').addEventListener('mousedown', (e) => { e.stopPropagation(); addCallback(); });
  }
  el.appendChild(header);
  el.appendChild(body);
  return { el, body };
}

function createModifierFrame(mod, index, parentPath, arrayKey) {
  const shortClass = getShortClass(mod._class);
  const frame = document.createElement('div');
  frame.className = 'frame';
  const open = true;

  const header = document.createElement('div');
  header.className = 'frame-header';
  const isMod = arrayKey === 'm_Modifiers';
  header.style.borderLeft = `3px solid ${isMod ? 'var(--mauve)' : 'var(--yellow)'}`;
  header.innerHTML = `<span class="frame-toggle ${open ? '' : 'collapsed'}">${ICONS.chevronDown}</span><span class="frame-name">${shortClass}</span><span class="frame-actions"><button title="Move Up" onclick="moveModifier('${parentPath}','${arrayKey}',${index},-1)">${ICONS.arrowUp}</button><button title="Move Down" onclick="moveModifier('${parentPath}','${arrayKey}',${index},1)">${ICONS.arrowDown}</button><button title="Duplicate" onclick="duplicateModifier('${parentPath}','${arrayKey}',${index})">${ICONS.duplicate}</button><button class="del" title="Delete" onclick="deleteModifier('${parentPath}','${arrayKey}',${index})">${ICONS.x}</button></span>`;

  const body = document.createElement('div');
  body.className = 'frame-body' + (open ? '' : ' collapsed');

  header.addEventListener('click', (e) => {
    if (e.target.closest('.frame-actions')) return;
    const isCollapsed = body.classList.toggle('collapsed');
    header.querySelector('.frame-toggle').classList.toggle('collapsed', isCollapsed);
  });

  // Render properties
  const propKeys = PROP_MAP[shortClass];
  const keys = propKeys || Object.keys(mod).filter(k => k !== '_class' && k !== 'm_nElementID');
  keys.forEach(key => {
    if (key === 'm_nElementID') return;
    const val = mod[key] !== undefined ? mod[key] : null;
    body.appendChild(createPropertyWidget(key, val, (newVal) => {
      pushUndo('Edit Property');
      const parentNode = resolveNode(parentPath);
      if (!parentNode) return;
      const arr = parentNode[arrayKey];
      if (!arr || !arr[index]) return;
      if (newVal === null || newVal === undefined) delete arr[index][key];
      else arr[index][key] = newVal;
      updatePreview();
    }));
  });

  frame.appendChild(header);
  frame.appendChild(body);
  return frame;
}

// Modifier operations
function deleteModifier(parentPath, arrayKey, index) {
  pushUndo('Delete Modifier');
  const node = resolveNode(parentPath);
  if (node && node[arrayKey]) { node[arrayKey].splice(index, 1); renderAll(); }
}
function duplicateModifier(parentPath, arrayKey, index) {
  pushUndo('Duplicate Modifier');
  const node = resolveNode(parentPath);
  if (node && node[arrayKey] && node[arrayKey][index]) {
    const clone = deepClone(node[arrayKey][index]);
    if ('m_nElementID' in clone) clone.m_nElementID = genId();
    node[arrayKey].splice(index + 1, 0, clone);
    renderAll();
  }
}
function moveModifier(parentPath, arrayKey, index, direction) {
  const node = resolveNode(parentPath);
  if (!node || !node[arrayKey]) return;
  const arr = node[arrayKey];
  const newIdx = index + direction;
  if (newIdx < 0 || newIdx >= arr.length) return;
  pushUndo('Move Modifier');
  const item = arr.splice(index, 1)[0];
  arr.splice(newIdx, 0, item);
  renderAll();
}

// ===== PROPERTY WIDGETS =====
function detectPropType(key, value) {
  if (key === 'm_bEnabled') return 'bool';
  if (COMBO_OPTIONS[key]) return 'combo';
  if (key === 'm_HandleColor') return 'color';
  if (key === 'm_ColorChoices') return 'colorlist';
  if (key === 'm_VariableComparison') return 'comparison';
  if (key === 'm_VariableValue' && value && typeof value === 'object' && 'm_TargetName' in value) return 'setvar';
  if (key === 'm_AllowedSurfaceProperties' || key === 'm_DisallowedSurfaceProperties') return 'stringlist';
  if (key === 'm_Comment') return 'comment';
  if (key === 'm_DefaultPath') return 'json';
  if (value && typeof value === 'object' && value.m_Components) return 'vec3';
  if (value && typeof value === 'object' && value.m_Expression !== undefined) return 'expression';
  if (value && typeof value === 'object' && value.m_SourceName !== undefined) return 'varref';
  if (Array.isArray(value) && value.length >= 2 && value.length <= 4 && typeof value[0] === 'number') return 'vec3';
  if (key.match(/^m_v[A-Z]/)) return 'vec3';
  if (key.match(/^m_fl[A-Z]/) || key.match(/^m_f[A-Z]/) || ['m_HandleSize', 'm_flMass', 'm_flProbability', 'm_flWeight', 'm_flRandomness', 'm_fRadius'].includes(key)) return 'float';
  if (key.match(/^m_n[A-Z]/) || ['m_SpecificChildIndex', 'm_ColorSelection', 'm_nCountMin', 'm_nCountMax'].includes(key)) return 'int';
  if (key.match(/^m_b[A-Z]/)) return 'bool';
  if (key.match(/^m_s[A-Z]/) || key === 'm_MaterialGroupName' || key === 'm_StateName' || key === 'm_PathName' || key.includes('OutputVariable') || key.includes('VariableName')) return 'string';
  if (key === 'm_Expression') return 'expression';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'float';
  if (typeof value === 'string') return 'string';
  return 'string';
}

function getPropColor(type) {
  switch(type) {
    case 'float': return 'var(--color-float)';
    case 'int': return 'var(--color-int)';
    case 'string': return 'var(--color-string)';
    case 'expression': return 'var(--color-expr)';
    case 'vec3': return 'var(--color-vec3)';
    case 'color': return 'var(--color-color)';
    default: return 'var(--text-primary)';
  }
}

// Determine whether a property supports input-choice mode selector
function supportsInputChoice(type, isVariable = false) {
  if (isVariable) return false; // Variable fields always use plain direct inputs
  return ['float','int','string','bool','vec3','combo','expression'].includes(type);
}

// Determine current input mode from stored value
function detectInputMode(value, _type) {
  if (value === null || value === undefined) return 'default';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.m_Expression !== undefined) return 'expression';
    if (value.m_SourceName !== undefined) return 'variable';
    if (value.m_Components !== undefined) return 'value';
  }
  return 'value';
}

// Get the list of defined variable names for the variable dropdown
function getVariableNames() {
  return (doc.m_Variables || []).map(v => v.m_VariableName || 'unnamed');
}

// Create a slider + spinbox combo widget
function createSliderWidget(val, step, isInt, onInput) {
  const w = document.createElement('div');
  w.className = 'slider-widget';
  const numInp = document.createElement('input');
  numInp.type = 'number';
  numInp.step = step;
  numInp.value = val != null ? val : 0;
  const slider = document.createElement('input');
  slider.type = 'range';
  // Dynamic range based on value
  const absVal = Math.abs(val || 0);
  let sMin, sMax;
  if (absVal < 1) { sMin = isInt ? -10 : -1; sMax = isInt ? 10 : 1; }
  else if (absVal < 100) { sMin = isInt ? Math.floor(-absVal * 5) : -absVal * 5; sMax = isInt ? Math.ceil(absVal * 5) : absVal * 5; }
  else { sMin = isInt ? Math.floor(-absVal * 2) : -absVal * 2; sMax = isInt ? Math.ceil(absVal * 2) : absVal * 2; }
  if (sMin >= sMax) { sMin = isInt ? -100 : -10; sMax = isInt ? 100 : 10; }
  slider.min = sMin;
  slider.max = sMax;
  slider.step = step;
  slider.value = val != null ? val : 0;
  numInp.addEventListener('change', () => {
    const v = isInt ? (parseInt(numInp.value) || 0) : (parseFloat(numInp.value) || 0);
    slider.value = v;
    // Expand range if needed
    if (v < parseFloat(slider.min)) slider.min = v * 2;
    if (v > parseFloat(slider.max)) slider.max = v * 2;
    onInput(v);
  });
  slider.addEventListener('mousedown', () => {
    sliderDragging = true;
    sliderDragUndoPushed = false;
  });
  slider.addEventListener('input', () => {
    const v = isInt ? parseInt(slider.value) : parseFloat(slider.value);
    numInp.value = v;
    onInput(v);
  });
  w.appendChild(numInp);
  w.appendChild(slider);
  return w;
}

// Single global listener resets drag state when the mouse button is released
// anywhere on the page (handles releasing outside the slider track).
document.addEventListener('mouseup', () => {
  sliderDragging = false;
  sliderDragUndoPushed = false;
}, true);

// Return a human-readable label for the "value" mode that reflects the field's actual type.
function getValueModeLabel(type, key) {
  if (type === 'float')  return 'Float';
  if (type === 'int')    return 'Int';
  if (type === 'bool')   return 'Bool';
  if (type === 'string') return 'String';
  if (type === 'combo') {
    // Strip Hungarian-notation prefix (m_fl, m_n, m_b, m_s, m_v, m_f, m_) to get the enum name.
    const s = key.replace(/^m_(?:fl|[nfbsv])?/, '');
    return s || 'Value';
  }
  return 'Value';
}

// Build the input-choice widget wrapper
function buildInputChoiceWidget(key, value, type, onChange, isVec3Component, isVariable = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'input-choice-row';
  const sel = document.createElement('select');
  sel.className = 'input-choice-select';

  const valueLabel = getValueModeLabel(type, key);
  let modes;
  if (isVariable) {
    modes = [['default','Default'], ['value', valueLabel]];
  } else if (isVec3Component) {
    modes = [['value', valueLabel], ['variable','Variable'], ['expression','Expression']];
  } else {
    modes = [['default','Default'], ['value', valueLabel], ['variable','Variable'], ['expression','Expression']];
  }

  modes.forEach(([val, label]) => {
    const o = document.createElement('option');
    o.value = val; o.textContent = label;
    sel.appendChild(o);
  });

  const body = document.createElement('div');
  body.className = 'input-choice-body';
  wrapper.appendChild(sel);
  wrapper.appendChild(body);

  const currentMode = detectInputMode(value, type);
  // For vec3 component default is same as value
  sel.value = (isVec3Component && currentMode === 'default') ? 'value' : currentMode;

  function renderMode(mode, shouldEmit = true) {
    body.innerHTML = '';
    if (mode === 'default') {
      const def = document.createElement('div');
      def.className = 'input-choice-default';
      def.textContent = '(default)';
      body.appendChild(def);
      if (shouldEmit) onChange(null);
      return;
    }
    if (mode === 'variable') {
      const varSel = document.createElement('select');
      varSel.className = 'prop-input';
      varSel.style.borderRadius = '0 var(--radius-sm) var(--radius-sm) 0';
      const varNames = getVariableNames();
      const emptyOpt = document.createElement('option');
      emptyOpt.value = ''; emptyOpt.textContent = '-- Select Variable --';
      varSel.appendChild(emptyOpt);
      varNames.forEach(n => {
        const o = document.createElement('option');
        o.value = n; o.textContent = n;
        varSel.appendChild(o);
      });
      // Current value
      if (value && typeof value === 'object' && value.m_SourceName) varSel.value = value.m_SourceName;
      varSel.addEventListener('change', () => {
        if (varSel.value) onChange({ m_SourceName: varSel.value });
      });
      body.appendChild(varSel);
      return;
    }
    if (mode === 'expression') {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'prop-input';
      inp.style.fontFamily = 'var(--font-mono)';
      inp.style.color = 'var(--color-expr)';
      inp.style.borderRadius = '0 var(--radius-sm) var(--radius-sm) 0';
      inp.placeholder = 'Expression...';
      if (value && typeof value === 'object' && value.m_Expression !== undefined) inp.value = value.m_Expression;
      inp.addEventListener('change', () => {
        onChange({ m_Expression: inp.value });
      });
      body.appendChild(inp);
      return;
    }
    // mode === 'value'
    let rawValue = value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.m_Expression !== undefined) rawValue = parseFloat(value.m_Expression) || 0;
      else if (value.m_SourceName !== undefined) rawValue = 0;
      else if (value.m_Components !== undefined) rawValue = value.m_Components;
    }
    if (type === 'float') {
      const sw = createSliderWidget(rawValue != null ? rawValue : 0, '0.1', false, (v) => onChange(v));
      sw.querySelector('input[type=number]').style.borderRadius = '0';
      body.appendChild(sw);
    } else if (type === 'int') {
      const sw = createSliderWidget(rawValue != null ? Math.round(rawValue) : 0, '1', true, (v) => onChange(v));
      sw.querySelector('input[type=number]').style.borderRadius = '0';
      body.appendChild(sw);
    } else if (type === 'bool') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'prop-check';
      cb.checked = !!rawValue;
      cb.addEventListener('change', () => onChange(cb.checked));
      body.appendChild(cb);
    } else if (type === 'string') {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'prop-input';
      inp.style.borderRadius = '0 var(--radius-sm) var(--radius-sm) 0';
      inp.value = rawValue != null ? String(rawValue) : '';
      inp.addEventListener('change', () => onChange(inp.value));
      body.appendChild(inp);
    } else if (type === 'combo') {
      const combSel = document.createElement('select');
      combSel.className = 'prop-input';
      combSel.style.borderRadius = '0 var(--radius-sm) var(--radius-sm) 0';
      const options = COMBO_OPTIONS[key] || [];
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (opt === rawValue) o.selected = true;
        combSel.appendChild(o);
      });
      combSel.addEventListener('change', () => onChange(combSel.value));
      body.appendChild(combSel);
    } else if (type === 'expression') {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'prop-input';
      inp.style.fontFamily = 'var(--font-mono)';
      inp.style.borderRadius = '0 var(--radius-sm) var(--radius-sm) 0';
      inp.value = rawValue != null ? String(rawValue) : '';
      inp.placeholder = 'Expression...';
      inp.addEventListener('change', () => onChange({ m_Expression: inp.value }));
      body.appendChild(inp);
    }
  }

  renderMode(sel.value, false);
  sel.addEventListener('change', () => {
    pushUndo('Edit Property');
    renderMode(sel.value, true);
  });
  return wrapper;
}

// Plain XYZ number inputs — used for vector variable default values (no mode selectors)
function buildSimpleVec3Widget(value, onChange) {
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1';
  const axes = ['X', 'Y', 'Z'];
  const colors = ['#f38ba8', '#a6e3a1', '#89b4fa'];
  const comps = Array.isArray(value) ? [...value] : [0, 0, 0];
  while (comps.length < 3) comps.push(0);
  axes.forEach((axis, ai) => {
    const row = document.createElement('div');
    row.className = 'vec3-comp-row';
    const lbl = document.createElement('span');
    lbl.className = 'vec3-comp-label';
    lbl.style.color = colors[ai];
    lbl.textContent = axis;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'prop-input'; inp.step = '0.01';
    inp.value = typeof comps[ai] === 'number' ? comps[ai] : 0;
    inp.addEventListener('change', () => {
      comps[ai] = parseFloat(inp.value) || 0;
      onChange([...comps]);
    });
    row.appendChild(lbl);
    row.appendChild(inp);
    container.appendChild(row);
  });
  return container;
}

// Build vec3 widget with top-level mode (Default/Variable/Components) and per-component modes
function buildVec3Widget(key, value, onChange, isVariable = false) {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '4px';
  container.style.flex = '1';

  // Determine top-level mode
  let topMode = 'default';
  if (value !== null && value !== undefined) {
    if (typeof value === 'object' && !Array.isArray(value)) {
      if (value.m_SourceName !== undefined) topMode = 'variable';
      else if (value.m_Components !== undefined) topMode = 'components';
      else if (value.m_Expression !== undefined) topMode = 'expression';
    } else if (Array.isArray(value)) {
      topMode = 'components';
    }
  }

  // Top-level selector
  const topRow = document.createElement('div');
  topRow.className = 'vec3-choice-row';
  const topSel = document.createElement('select');
  topSel.className = 'vec3-choice-select';
  [['default','Default'],['variable','Variable'],['components','Components']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l; topSel.appendChild(o);
  });
  topSel.value = topMode;
  topRow.appendChild(topSel);

  const topBody = document.createElement('div');
  topBody.style.flex = '1';
  topBody.style.minWidth = '0';
  topBody.style.display = 'flex';
  topBody.style.alignItems = 'center';
  topRow.appendChild(topBody);
  container.appendChild(topRow);

  const compContainer = document.createElement('div');
  compContainer.className = 'vec3-components';
  container.appendChild(compContainer);

  function isWrappedComponents(v) {
    return v && typeof v === 'object' && !Array.isArray(v) && v.m_Components !== undefined;
  }

  function getComponents() {
    if (Array.isArray(value)) return [...value];
    if (isWrappedComponents(value)) return [...(value.m_Components || [0,0,0])];
    return [0, 0, 0];
  }

  function emitValue(newValue) {
    // Preserve wrapper format: if original used m_Components, keep it
    if (isWrappedComponents(value) && Array.isArray(newValue)) {
      onChange({ m_Components: newValue });
    } else {
      onChange(newValue);
    }
  }

  function renderTopMode(mode, shouldEmit = true) {
    topBody.innerHTML = '';
    compContainer.innerHTML = '';
    if (mode === 'default') {
      const def = document.createElement('div');
      def.className = 'input-choice-default';
      def.textContent = '(default)';
      def.style.borderRadius = 'var(--radius-sm)';
      def.style.marginLeft = '4px';
      topBody.appendChild(def);
      if (shouldEmit) onChange(null);
      return;
    }
    if (mode === 'variable') {
      const varSel = document.createElement('select');
      varSel.className = 'prop-input';
      varSel.style.marginLeft = '4px';
      const varNames = getVariableNames();
      const emptyOpt = document.createElement('option');
      emptyOpt.value = ''; emptyOpt.textContent = '-- Select Variable --';
      varSel.appendChild(emptyOpt);
      varNames.forEach(n => {
        const o = document.createElement('option'); o.value = n; o.textContent = n; varSel.appendChild(o);
      });
      if (value && typeof value === 'object' && value.m_SourceName) varSel.value = value.m_SourceName;
      varSel.addEventListener('change', () => {
        if (varSel.value) onChange({ m_SourceName: varSel.value });
      });
      topBody.appendChild(varSel);
      return;
    }
    // mode === 'components'
    const axes = ['X','Y','Z'];
    const colors = ['#f38ba8','#a6e3a1','#89b4fa'];
    const comps = getComponents();

    axes.forEach((axis, ai) => {
      const compRow = document.createElement('div');
      compRow.className = 'vec3-comp-row';
      const lbl = document.createElement('span');
      lbl.className = 'vec3-comp-label';
      lbl.style.color = colors[ai];
      lbl.textContent = axis;
      compRow.appendChild(lbl);

      // Each component can be: value (float+slider), variable, expression
      const compVal = comps[ai];
      const compWidget = buildInputChoiceWidget(key + '.' + axis, compVal, 'float', (newVal) => {
        const newComps = getComponents();
        newComps[ai] = newVal;
        emitValue(newComps);
      }, true /* isVec3Component */, isVariable);
      compRow.appendChild(compWidget);
      compContainer.appendChild(compRow);
    });
  }

  renderTopMode(topMode, false);
  topSel.addEventListener('change', () => {
    pushUndo('Edit Property');
    renderTopMode(topSel.value, true);
  });
  return container;
}

function createPropertyWidget(key, value, onChange, varType, isVariable = false) {
  const type = varType ? detectVarPropType(varType) : detectPropType(key, value);
  const row = document.createElement('div');
  row.className = 'prop-row';
  const label = document.createElement('span');
  label.className = 'prop-label';
  label.textContent = prettify(key);
  label.title = key;
  label.style.color = getPropColor(type);
  const valDiv = document.createElement('div');
  valDiv.className = 'prop-value';

  // Vec3: for variables use a simple XYZ input, for regular props use the full widget
  if (type === 'vec3') {
    if (isVariable) {
      valDiv.appendChild(buildSimpleVec3Widget(value, onChange));
    } else {
      valDiv.appendChild(buildVec3Widget(key, value, onChange, false));
    }
    row.appendChild(label);
    row.appendChild(valDiv);
    return row;
  }

  // Types that support input-choice mode selector (never for variables)
  if (supportsInputChoice(type, isVariable)) {
    valDiv.appendChild(buildInputChoiceWidget(key, value, type, onChange, false, false));
    row.appendChild(label);
    row.appendChild(valDiv);
    return row;
  }

  // Special/complex types that don't get input-choice
  let actualValue = value;
  if (value && typeof value === 'object' && !(Array.isArray(value))) {
    if (value.m_Expression !== undefined) { actualValue = value.m_Expression; }
    else if (value.m_SourceName !== undefined) { actualValue = value.m_SourceName; }
    else if (value.m_Components !== undefined) { actualValue = value.m_Components; }
  }

  switch (type) {
    case 'float': {
      const sw = createSliderWidget(typeof actualValue === 'number' ? actualValue : 0, '0.01', false, (v) => onChange(v));
      valDiv.appendChild(sw);
      break;
    }
    case 'int': {
      const sw = createSliderWidget(typeof actualValue === 'number' ? Math.round(actualValue) : 0, '1', true, (v) => onChange(v));
      valDiv.appendChild(sw);
      break;
    }
    case 'string': {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'prop-input';
      inp.value = actualValue != null ? String(actualValue) : '';
      inp.addEventListener('change', () => onChange(inp.value));
      valDiv.appendChild(inp);
      break;
    }
    case 'bool': {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'prop-check';
      cb.checked = !!actualValue;
      cb.addEventListener('change', () => onChange(cb.checked));
      valDiv.appendChild(cb);
      break;
    }
    case 'color': {
      const colorInp = document.createElement('input');
      colorInp.type = 'color';
      colorInp.className = 'prop-color';
      if (Array.isArray(actualValue)) {
        colorInp.value = rgbToHex(actualValue[0] || 0, actualValue[1] || 0, actualValue[2] || 0);
      }
      colorInp.addEventListener('input', () => {
        const hex = colorInp.value;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        onChange([r, g, b]);
      });
      valDiv.appendChild(colorInp);
      break;
    }
    case 'comparison': {
      const comp = value || { m_Name: '', m_Value: 0, m_Comparison: 'EQUAL' };
      const nameInp = document.createElement('input');
      nameInp.type = 'text'; nameInp.className = 'prop-input'; nameInp.style.width = '80px'; nameInp.placeholder = 'Variable';
      nameInp.value = comp.m_Name || '';
      const opSel = document.createElement('select');
      opSel.className = 'prop-input'; opSel.style.width = '60px';
      (COMBO_OPTIONS.m_Comparison || []).forEach(o => { const opt = document.createElement('option'); opt.value = o; opt.textContent = o.replace(/_/g,' '); if (o === comp.m_Comparison) opt.selected = true; opSel.appendChild(opt); });
      const valInp = document.createElement('input');
      valInp.type = 'text'; valInp.className = 'prop-input'; valInp.style.width = '60px'; valInp.placeholder = 'Value';
      valInp.value = comp.m_Value != null ? comp.m_Value : '';
      function emitComp() {
        let v = valInp.value;
        try { v = JSON.parse(v); } catch(e) {}
        onChange({ m_Name: nameInp.value, m_Value: v, m_Comparison: opSel.value });
      }
      nameInp.addEventListener('change', emitComp);
      opSel.addEventListener('change', emitComp);
      valInp.addEventListener('change', emitComp);
      valDiv.appendChild(nameInp); valDiv.appendChild(opSel); valDiv.appendChild(valInp);
      break;
    }
    case 'colorlist': {
      const list = Array.isArray(value) ? value : [];
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex'; wrapper.style.flexDirection = 'column'; wrapper.style.gap = '4px'; wrapper.style.flex = '1';
      list.forEach((color, ci) => {
        const cr = document.createElement('div');
        cr.style.display = 'flex'; cr.style.gap = '4px'; cr.style.alignItems = 'center';
        const ci2 = document.createElement('input');
        ci2.type = 'color'; ci2.className = 'prop-color';
        if (Array.isArray(color)) ci2.value = rgbToHex(color[0]||0,color[1]||0,color[2]||0);
        ci2.addEventListener('input', () => {
          const hex = ci2.value;
          const newList = deepClone(list);
          newList[ci] = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
          onChange(newList);
        });
        const del = document.createElement('button');
        del.className = 'btn btn-sm btn-icon btn-danger'; del.innerHTML = ICONS.x;
        del.addEventListener('click', () => { const newList = deepClone(list); newList.splice(ci,1); onChange(newList); renderProperties(); });
        cr.appendChild(ci2); cr.appendChild(del);
        wrapper.appendChild(cr);
      });
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-sm'; addBtn.textContent = '+ Color';
      addBtn.addEventListener('click', () => { const newList = deepClone(list); newList.push([255,255,255]); onChange(newList); renderProperties(); });
      wrapper.appendChild(addBtn);
      valDiv.appendChild(wrapper);
      break;
    }
    case 'stringlist': {
      const list = Array.isArray(value) ? value : [];
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex'; wrapper.style.flexDirection = 'column'; wrapper.style.gap = '2px'; wrapper.style.flex = '1';
      list.forEach((s, si) => {
        const sr = document.createElement('div');
        sr.style.display = 'flex'; sr.style.gap = '4px';
        const sinp = document.createElement('input');
        sinp.type = 'text'; sinp.className = 'prop-input'; sinp.value = s;
        sinp.addEventListener('change', () => { const nl = [...list]; nl[si] = sinp.value; onChange(nl); });
        const del = document.createElement('button');
        del.className = 'btn btn-sm btn-icon btn-danger'; del.innerHTML = ICONS.x;
        del.addEventListener('click', () => { const nl = [...list]; nl.splice(si,1); onChange(nl); renderProperties(); });
        sr.appendChild(sinp); sr.appendChild(del);
        wrapper.appendChild(sr);
      });
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-sm'; addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => { onChange([...list, '']); renderProperties(); });
      wrapper.appendChild(addBtn);
      valDiv.appendChild(wrapper);
      break;
    }
    case 'comment': {
      const ta = document.createElement('textarea');
      ta.className = 'prop-input';
      ta.style.minHeight = '60px'; ta.style.resize = 'vertical'; ta.style.fontFamily = 'var(--font-mono)';
      ta.value = actualValue || '';
      ta.addEventListener('change', () => onChange(ta.value));
      valDiv.appendChild(ta);
      break;
    }
    case 'setvar': {
      const sv = value || { m_TargetName: null, m_DataType: null, m_Value: null };
      const tn = document.createElement('input');
      tn.type = 'text'; tn.className = 'prop-input'; tn.placeholder = 'Target Name'; tn.value = sv.m_TargetName || '';
      const dt = document.createElement('input');
      dt.type = 'text'; dt.className = 'prop-input'; dt.placeholder = 'Data Type'; dt.value = sv.m_DataType || '';
      const vl = document.createElement('input');
      vl.type = 'text'; vl.className = 'prop-input'; vl.placeholder = 'Value'; vl.value = sv.m_Value != null ? JSON.stringify(sv.m_Value) : '';
      function emitSV() {
        let v = vl.value; try { v = JSON.parse(v); } catch(e) {}
        onChange({ m_TargetName: tn.value || null, m_DataType: dt.value || null, m_Value: v });
      }
      tn.addEventListener('change', emitSV); dt.addEventListener('change', emitSV); vl.addEventListener('change', emitSV);
      const w = document.createElement('div');
      w.style.display='flex';w.style.flexDirection='column';w.style.gap='4px';w.style.flex='1';
      w.appendChild(tn);w.appendChild(dt);w.appendChild(vl);
      valDiv.appendChild(w);
      break;
    }
    case 'json': {
      const ta = document.createElement('textarea');
      ta.className = 'prop-input';
      ta.style.minHeight = '40px'; ta.style.resize = 'vertical'; ta.style.fontFamily = 'var(--font-mono)'; ta.style.fontSize = '10px';
      ta.value = JSON.stringify(actualValue, null, 2);
      ta.addEventListener('change', () => { try { onChange(JSON.parse(ta.value)); } catch(e) { /* keep old */ } });
      valDiv.appendChild(ta);
      break;
    }
    default: {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'prop-input';
      inp.value = actualValue != null ? String(actualValue) : '';
      inp.addEventListener('change', () => onChange(inp.value));
      valDiv.appendChild(inp);
    }
  }

  row.appendChild(label);
  row.appendChild(valDiv);
  return row;
}

function detectVarPropType(varType) {
  if (varType === 'Bool') return 'bool';
  if (varType === 'Int') return 'int';
  if (varType === 'Float') return 'float';
  if (varType === 'String' || varType === 'Model' || varType === 'MaterialGroup') return 'string';
  if (varType === 'Vector3D' || varType === 'Angles' || varType === 'Color') return 'vec3';
  if (varType === 'Vector2D') return 'vec3';
  return 'string';
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

// ===== PREVIEW / JSON / KV3 =====
function updatePreview() {
  const jsonEl = document.getElementById('jsonEditor');
  const kv3El = document.getElementById('kv3Editor');
  if (jsonEl) jsonEl.value = JSON.stringify(doc, null, 2);
  if (kv3El) kv3El.value = jsonToKV3(doc);
}

function syntaxHighlight(json) {
  return json.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="key">"$1"</span>')
    .replace(/:\s*"([^"]*)"/g, ': <span class="str">"$1"</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span class="num">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="bool">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="null">$1</span>');
}

function switchTab(btn, tabId) {
  btn.parentElement.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  btn.closest('.panel').querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  if (tabId === 'jsonEdit') document.getElementById('jsonEditor').value = JSON.stringify(doc, null, 2);
  if (tabId === 'kv3Tab') document.getElementById('kv3Editor').value = jsonToKV3(doc);
  if (tabId === 'historyTab') renderUndoHistory();
}

function applyJSONEdit() {
  try {
    const newDoc = JSON.parse(document.getElementById('jsonEditor').value);
    pushUndo('Apply JSON');
    doc = newDoc;
    recalcAllIds();
    renderAll();
    setStatus('JSON applied successfully');
  } catch (e) {
    setStatus('Invalid JSON: ' + e.message);
  }
}

function applyKV3Edit() {
  try {
    document.getElementById('kv3Editor').removeAttribute('readonly');
    const kv3 = document.getElementById('kv3Editor').value;
    const parsed = kv3ToJSON(kv3);
    pushUndo('Apply KV3');
    doc = parsed;
    recalcAllIds();
    renderAll();
    setStatus('KV3 applied successfully');
  } catch (e) {
    setStatus('KV3 parse error: ' + e.message);
  }
}

function copyKV3() {
  navigator.clipboard.writeText(document.getElementById('kv3Editor').value);
  setStatus('KV3 copied to clipboard');
}

// ===== FILE OPERATIONS =====
function newDocument() {
  pushUndo('New Document');
  doc = { generic_data_type: 'CSmartPropRoot', m_Children: [], m_Variables: [] };
  nextElementId = 1;
  selectedNodePath = null;
  currentFilePath = null;
  setDocumentTitle('Untitled');
  renderAll();
  setStatus('New document created');
}

function importKV3() {
  const input = document.getElementById('fileInput');
  input.accept = '.vsmart,.vdata,.kv3,.txt';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = kv3ToJSON(ev.target.result);
        pushUndo('Open');
        doc = parsed;
        if (!doc.m_Children) doc.m_Children = [];
        if (!doc.m_Variables) doc.m_Variables = [];
        recalcAllIds();
        selectedNodePath = null;
        setDocumentTitle(file.name);
        renderAll();
        setStatus('Opened: ' + file.name);
      } catch (err) {
        setStatus('Open error: ' + err.message);
      }
    };
    reader.readAsText(file);
    input.value = '';
  };
  input.click();
}

function saveFile() {
  if (currentFilePath && window.electronAPI?.saveFile) {
    window.electronAPI.saveFile(currentFilePath, jsonToKV3(doc))
      .then(() => setStatus('Saved: ' + currentFileName))
      .catch(e => setStatus('Save error: ' + e.message));
  } else {
    saveFileAs();
  }
}

function saveFileAs() {
  if (window.electronAPI?.showSaveDialog) {
    const base = currentFileName.replace(/\.[^.]+$/, '') || 'untitled';
    window.electronAPI.showSaveDialog({
      defaultPath: base + '.vsmart',
      filters: [
        { name: 'SmartProp', extensions: ['vsmart', 'vdata'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }).then(result => {
      if (result.canceled || !result.filePath) return;
      window.electronAPI.saveFile(result.filePath, jsonToKV3(doc))
        .then(() => {
          currentFilePath = result.filePath;
          setDocumentTitle(result.filePath.split(/[\\/]/).pop());
          setStatus('Saved: ' + currentFileName);
        })
        .catch(e => setStatus('Save error: ' + e.message));
    });
  } else {
    const base = currentFileName.replace(/\.[^.]+$/, '') || 'untitled';
    downloadBlob(new Blob([jsonToKV3(doc)], { type: 'text/plain' }), base + '.vsmart');
  }
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== TOOLBAR BUTTONS =====
document.getElementById('btnAddElement').addEventListener('click', (e) => {
  e.stopPropagation();
  const rect = e.target.getBoundingClientRect();
  showElementPicker(rect.left, rect.bottom + 4, (typeName) => {
    pushUndo('Add Element');
    const node = createElement(typeName);
    // If an element is selected and can have children, add as child
    if (selectedNodePath && selectedNodePath.startsWith('children')) {
      const sel = resolveNode(selectedNodePath);
      if (sel && sel.m_Children !== undefined) {
        sel.m_Children.push(node);
        expandedNodes.add(selectedNodePath);
        renderAll();
        return;
      }
    }
    doc.m_Children.push(node);
    expandedNodes.add('children');
    renderAll();
  });
});

document.getElementById('btnAddVariable').addEventListener('click', (e) => {
  e.stopPropagation();
  const rect = e.target.getBoundingClientRect();
  const items = VARIABLE_TYPES.map(t => ({
    label: t, action: () => { pushUndo('Add Variable'); doc.m_Variables.push(createVariable(t)); expandedNodes.add('variables'); renderAll(); }
  }));
  showMenu(rect.left, rect.bottom + 4, [{ header: 'Variable Type' }, ...items]);
});

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'n') { e.preventDefault(); newDocument(); return; }
    if (e.key === 's') {
      e.preventDefault();
      if (e.shiftKey) saveFileAs(); else saveFile();
      return;
    }
    if (e.key === 'z') { e.preventDefault(); undo(); } else
    if (e.key === 'y') { e.preventDefault(); redo(); } else
    if (e.key === 'Z' && e.shiftKey) { e.preventDefault(); redo(); }
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'd') { e.preventDefault(); if (selectedNodePath) duplicateNode(selectedNodePath); }
    if (e.key === 'c') { e.preventDefault(); if (selectedNodePath) copyNode(selectedNodePath); }
    if (e.key === 'x') { e.preventDefault(); if (selectedNodePath) cutNode(selectedNodePath); }
    if (e.key === 'v') { e.preventDefault(); if (selectedNodePath && clipboard) pasteNode(selectedNodePath); }
    if (e.key === 'f') { e.preventDefault(); document.getElementById('treeSearch').focus(); }
  }
  if (e.key === 'Delete' && selectedNodePath) { e.preventDefault(); deleteNode(selectedNodePath); }
});

// ===== STATUS =====
function setStatus(msg) { document.getElementById('statusBar').textContent = msg; }

function setDocumentTitle(name) {
  currentFileName = name;
  document.title = 'VsmartEditor2 - ' + name;
}
function updateStatus() {
  const elCount = countNodes(doc.m_Children);
  const varCount = doc.m_Variables.length;
  setStatus(`Elements: ${elCount} | Variables: ${varCount}`);
}
function countNodes(arr) {
  let c = 0;
  if (!arr) return 0;
  arr.forEach(n => {
    c++;
    if (n.m_Children) c += countNodes(n.m_Children);
    if (n.m_Modifiers) c += n.m_Modifiers.length;
    if (n.m_SelectionCriteria) c += n.m_SelectionCriteria.length;
  });
  return c;
}

// ===== DOCKABLE PANELS & RESIZE =====
const dockPanelMap = {
  hierarchy: document.getElementById('hierarchyPanel'),
  properties: document.getElementById('propsPanel'),
  history: document.getElementById('historyPanel')
};
const dockFloatingState = {}; // track undocked panels

function undockPanel(id) {
  const panel = dockPanelMap[id];
  if (!panel || panel.classList.contains('dock-floating')) return;
  const rect = panel.getBoundingClientRect();
  const container = document.getElementById('dockContainer');
  // Remember original position
  dockFloatingState[id] = {
    nextSibling: panel.nextElementSibling,
    parent: panel.parentElement,
    width: panel.style.width,
    flex: panel.style.flex,
    minWidth: panel.style.minWidth
  };
  // Move to absolute positioning within container
  panel.classList.add('dock-floating');
  panel.style.left = Math.min(rect.left, window.innerWidth - 400) + 'px';
  panel.style.top = Math.min(rect.top, window.innerHeight - 300) + 'px';
  panel.style.width = Math.max(rect.width, 300) + 'px';
  panel.style.height = Math.max(rect.height, 250) + 'px';
  panel.style.flex = 'none';
  panel.style.minWidth = '0';
  container.appendChild(panel);
  // Update undock button to redock
  const btn = panel.querySelector('.dock-handle-actions button[onclick*="undockPanel"]');
  if (btn) {
    btn.onclick = () => redockPanel(id);
    btn.title = 'Dock';
    btn.innerHTML = ICONS.dock;
  }
  // Make draggable
  makeDraggable(panel, panel.querySelector('.dock-handle'));
  makeResizable(panel);
}

function redockPanel(id) {
  const panel = dockPanelMap[id];
  if (!panel || !panel.classList.contains('dock-floating')) return;
  const state = dockFloatingState[id];
  panel.classList.remove('dock-floating');
  panel.style.left = '';
  panel.style.top = '';
  panel.style.height = '';
  panel.style.position = '';
  if (state) {
    panel.style.width = state.width;
    panel.style.flex = state.flex;
    panel.style.minWidth = state.minWidth;
    // Re-insert at original position
    if (state.nextSibling && state.parent.contains(state.nextSibling)) {
      state.parent.insertBefore(panel, state.nextSibling);
    } else {
      state.parent.appendChild(panel);
    }
  }
  delete dockFloatingState[id];
  // Update button back to undock
  const btn = panel.querySelector('.dock-handle-actions button[onclick*="redockPanel"], .dock-handle-actions button[title="Dock"]');
  if (btn) {
    btn.onclick = () => undockPanel(id);
    btn.title = 'Undock';
    btn.innerHTML = ICONS.undock;
  }
  // Remove resize handles if added
  panel.querySelectorAll('.floating-resize-handle').forEach(h => h.remove());
}

function makeDraggable(panel, handle) {
  let startX, startY, startLeft, startTop;
  function onMouseDown(e) {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseInt(panel.style.left) || 0;
    startTop = parseInt(panel.style.top) || 0;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
  function onMouseMove(e) {
    panel.style.left = (startLeft + e.clientX - startX) + 'px';
    panel.style.top = (startTop + e.clientY - startY) + 'px';
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
  handle.addEventListener('mousedown', onMouseDown);
}

function makeResizable(panel) {
  const handle = document.createElement('div');
  handle.className = 'floating-resize-handle';
  handle.style.cssText = 'position:absolute;bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;z-index:101';
  panel.appendChild(handle);
  let startX, startY, startW, startH;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startW = panel.offsetWidth;
    startH = panel.offsetHeight;
    function onMove(e) {
      panel.style.width = Math.max(250, startW + e.clientX - startX) + 'px';
      panel.style.height = Math.max(200, startH + e.clientY - startY) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// Column resize handles
document.querySelectorAll('.dock-resize-h').forEach(handle => {
  let startX, leftPanel, rightPanel, startLeftW, startRightW;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('active');
    leftPanel = handle.previousElementSibling;
    rightPanel = handle.nextElementSibling;
    if (!leftPanel || !rightPanel) return;
    startX = e.clientX;
    startLeftW = leftPanel.offsetWidth;
    startRightW = rightPanel.offsetWidth;
    function onMove(e) {
      const dx = e.clientX - startX;
      const newLeft = Math.max(180, startLeftW + dx);
      const newRight = Math.max(200, startRightW - dx);
      leftPanel.style.width = newLeft + 'px';
      leftPanel.style.flex = 'none';
      rightPanel.style.width = newRight + 'px';
      if (rightPanel.style.flex === 'none' || !rightPanel.style.flex) {
        rightPanel.style.flex = 'none';
      }
    }
    function onUp() {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
});

// ===== CUSTOM MENU BAR =====
function initMenuBar() {
  const menuItems = document.querySelectorAll('.menu-item[data-menu]');
  const dropdowns = document.querySelectorAll('.menu-dropdown');
  let activeDropdown = null;

  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = item.dataset.menu;
      const dd = document.getElementById('menu' + menu.charAt(0).toUpperCase() + menu.slice(1));
      if (activeDropdown === dd) {
        activeDropdown.classList.remove('open');
        activeDropdown = null;
        return;
      }
      dropdowns.forEach(d => d.classList.remove('open'));
      if (dd) {
        dd.classList.add('open');
        const rect = item.getBoundingClientRect();
        dd.style.left = rect.left + 'px';
        dd.style.top = (rect.bottom) + 'px';
        activeDropdown = dd;
      }
    });
  });

  document.addEventListener('click', () => {
    dropdowns.forEach(d => d.classList.remove('open'));
    activeDropdown = null;
  });

  document.querySelectorAll('.menu-dropdown-item[data-action]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = el.dataset.action;
      if (action === 'newDocument') newDocument();
      else if (action === 'importKV3') importKV3();
      else if (action === 'saveFile') saveFile();
      else if (action === 'saveFileAs') saveFileAs();
      else if (action === 'quit') { if (window.electronAPI) window.electronAPI.quitApp(); else window.close(); }
      else if (action === 'addElement') document.getElementById('btnAddElement')?.click();
      else if (action === 'addVariable') document.getElementById('btnAddVariable')?.click();
      else if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'minimize' && window.electronAPI?.minimize) window.electronAPI.minimize();
      else if (action === 'zoom' && window.electronAPI?.zoom) window.electronAPI.zoom();
      else if (action === 'fullscreen' && window.electronAPI?.toggleFullScreen) window.electronAPI.toggleFullScreen();
      else if (action === 'about') {
        if (window.electronAPI?.getVersion) {
          window.electronAPI.getVersion().then(v => setStatus(`SmartProp Editor v${v}`));
        } else {
          setStatus('SmartProp Editor');
        }
      }
      dropdowns.forEach(d => d.classList.remove('open'));
      activeDropdown = null;
    });
  });
}

// ===== INIT =====
setDocumentTitle('Untitled');
initMenuBar();
renderAll();
const btnMod = document.getElementById('btnToggleModifiers');
const btnCrit = document.getElementById('btnToggleCriteria');
if (btnMod) btnMod.classList.toggle('active', showModifiersInTree);
if (btnCrit) btnCrit.classList.toggle('active', showSelectionCriteriaInTree);

// Show app version in footer if running under Electron
if (window.electronAPI?.getVersion) {
  window.electronAPI.getVersion().then(v => {
    const lbl = document.getElementById('versionLabel');
    if (lbl) lbl.textContent = `SmartProp Editor v${v}`;
  });
}

if (window.electronAPI) {
  window.electronAPI.onOpenFile((filePath) => {
    window.electronAPI.readFile(filePath).then(content => {
      try {
        const parsed = content.trim().startsWith('<!--')
          ? kv3ToJSON(content)
          : JSON.parse(content);
        const fileName = filePath.split(/[\\/]/).pop();
        pushUndo('Open File');
        doc = parsed;
        if (!doc.m_Children) doc.m_Children = [];
        if (!doc.m_Variables) doc.m_Variables = [];
        recalcAllIds();
        selectedNodePath = null;
        currentFilePath = filePath;
        setDocumentTitle(fileName);
        renderAll();
        setStatus('Opened: ' + fileName);
      } catch (e) {
        setStatus('Error opening file: ' + e.message);
      }
    });
  });
}
