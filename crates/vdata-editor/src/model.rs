//! Arena-backed document model.
//!
//! The UI never walks the recursive [`KvValue`] tree directly: on load it is
//! converted into a flat arena of nodes with stable `u32` ids. Stable ids are
//! what make undo/redo, virtualized rendering of multi-million-node trees,
//! and per-node UI state cheap. Nodes removed by the user stay in the arena
//! (detached) so undo can re-attach them without invalidating other ids.

use kv3::KvValue;

pub type NodeId = u32;

/// Scalar node contents (everything that is not an object/array).
#[derive(Debug, Clone, PartialEq)]
pub enum Scalar {
    Null,
    Bool(bool),
    Int(i64),
    Double(f64),
    Str(String),
    Typed { kind: String, value: String },
    /// A `//` line comment occupying an object/array slot.
    Comment(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Payload {
    Object(Vec<NodeId>),
    Array(Vec<NodeId>),
    Scalar(Scalar),
}

#[derive(Debug, Clone)]
pub struct Node {
    pub parent: Option<NodeId>,
    /// Key within the parent object; empty for array items and the root.
    pub key: String,
    pub payload: Payload,
    /// `subclass:` flag (serializes as `subclass:<value>`).
    pub subclass: bool,
    /// View state: children visible in the tree pane.
    pub expanded: bool,
}

pub struct DocModel {
    nodes: Vec<Node>,
    root: NodeId,
    /// Bumped on any content change (drives dirty state and text sync).
    pub rev: u64,
    /// Bumped on insert/remove/rename/replace (drives suggestion harvesting).
    pub structure_rev: u64,
    /// Bumped on expand/collapse (drives the flattened-row cache).
    pub view_rev: u64,
}

impl DocModel {
    pub fn from_value(value: &KvValue) -> Self {
        let mut model = DocModel {
            nodes: Vec::new(),
            root: 0,
            rev: 0,
            structure_rev: 0,
            view_rev: 0,
        };
        model.nodes = Vec::with_capacity(1024);
        let root = model.build(value, None, String::new());
        model.root = root;
        model.node_mut(root).expanded = true;
        // Pre-expand the first level of small documents.
        if model.nodes.len() < 5_000 {
            let children = model.children(root).to_vec();
            for child in children {
                model.node_mut(child).expanded = true;
            }
        }
        model
    }

    fn build(&mut self, value: &KvValue, parent: Option<NodeId>, key: String) -> NodeId {
        let id = self.nodes.len() as NodeId;
        self.nodes.push(Node {
            parent,
            key,
            payload: Payload::Scalar(Scalar::Null),
            subclass: false,
            expanded: false,
        });
        let payload = match value {
            KvValue::Null => Payload::Scalar(Scalar::Null),
            KvValue::Bool(b) => Payload::Scalar(Scalar::Bool(*b)),
            KvValue::Int(v) => Payload::Scalar(Scalar::Int(*v)),
            KvValue::Double(v) => Payload::Scalar(Scalar::Double(*v)),
            KvValue::String(s) => Payload::Scalar(Scalar::Str(s.clone())),
            KvValue::Typed { kind, value } => Payload::Scalar(Scalar::Typed {
                kind: kind.clone(),
                value: value.clone(),
            }),
            KvValue::Comment(text) => Payload::Scalar(Scalar::Comment(text.clone())),
            KvValue::Subclass(inner) => {
                let payload = self.build_container_or_scalar(inner, id);
                self.nodes[id as usize].subclass = true;
                payload
            }
            KvValue::Array(_) | KvValue::Object(_) => self.build_container_or_scalar(value, id),
        };
        self.nodes[id as usize].payload = payload;
        id
    }

    fn build_container_or_scalar(&mut self, value: &KvValue, id: NodeId) -> Payload {
        match value {
            KvValue::Array(items) => {
                let children = items
                    .iter()
                    .map(|item| self.build(item, Some(id), String::new()))
                    .collect();
                Payload::Array(children)
            }
            KvValue::Object(entries) => {
                let children = entries
                    .iter()
                    .map(|(k, v)| self.build(v, Some(id), k.clone()))
                    .collect();
                Payload::Object(children)
            }
            other => {
                // subclass: wrapping a scalar — keep the scalar.
                let mut tmp = DocModel {
                    nodes: Vec::new(),
                    root: 0,
                    rev: 0,
                    structure_rev: 0,
                    view_rev: 0,
                };
                let tmp_id = tmp.build(other, None, String::new());
                tmp.nodes[tmp_id as usize].payload.clone()
            }
        }
    }

    pub fn root(&self) -> NodeId {
        self.root
    }

    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id as usize]
    }

    pub fn node_mut(&mut self, id: NodeId) -> &mut Node {
        &mut self.nodes[id as usize]
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn children(&self, id: NodeId) -> &[NodeId] {
        match &self.node(id).payload {
            Payload::Object(c) | Payload::Array(c) => c,
            Payload::Scalar(_) => &[],
        }
    }

    pub fn is_container(&self, id: NodeId) -> bool {
        matches!(self.node(id).payload, Payload::Object(_) | Payload::Array(_))
    }

    /// Display label for a node: object key, array index, or "root".
    pub fn label(&self, id: NodeId) -> String {
        let node = self.node(id);
        if !node.key.is_empty() {
            return node.key.clone();
        }
        match node.parent {
            Some(parent) if matches!(self.node(parent).payload, Payload::Array(_)) => {
                let idx = self
                    .children(parent)
                    .iter()
                    .position(|&c| c == id)
                    .unwrap_or(0);
                format!("[{idx}]")
            }
            Some(_) => String::new(),
            None => "root".to_owned(),
        }
    }

    /// Path like `root.m_Children[2].m_sName` for the status bar.
    pub fn path(&self, id: NodeId) -> String {
        let mut segments = Vec::new();
        let mut cur = Some(id);
        while let Some(c) = cur {
            if c == self.root {
                break;
            }
            segments.push(self.label(c));
            cur = self.node(c).parent;
        }
        segments.reverse();
        let mut out = String::from("root");
        for s in segments {
            if !s.starts_with('[') {
                out.push('.');
            }
            out.push_str(&s);
        }
        out
    }

    // ---- Mutations (called via history commands) ----

    pub fn set_payload(&mut self, id: NodeId, payload: Payload) -> Payload {
        let structural = !matches!(
            (&self.node(id).payload, &payload),
            (Payload::Scalar(_), Payload::Scalar(_))
        );
        let old = std::mem::replace(&mut self.node_mut(id).payload, payload);
        self.rev += 1;
        if structural {
            self.structure_rev += 1;
            self.view_rev += 1;
        }
        old
    }

    pub fn set_subclass(&mut self, id: NodeId, subclass: bool) -> bool {
        let old = std::mem::replace(&mut self.node_mut(id).subclass, subclass);
        self.rev += 1;
        old
    }

    pub fn rename(&mut self, id: NodeId, key: String) -> String {
        let old = std::mem::replace(&mut self.node_mut(id).key, key);
        self.rev += 1;
        self.structure_rev += 1;
        old
    }

    /// Build a detached subtree from a value; attach it with [`Self::attach`].
    pub fn create_detached(&mut self, value: &KvValue, key: String) -> NodeId {
        let id = self.build(value, None, key);
        // New nodes start expanded so an inserted object is immediately visible.
        self.node_mut(id).expanded = true;
        id
    }

    pub fn attach(&mut self, parent: NodeId, index: usize, id: NodeId) {
        self.node_mut(id).parent = Some(parent);
        match &mut self.node_mut(parent).payload {
            Payload::Object(c) | Payload::Array(c) => {
                let index = index.min(c.len());
                c.insert(index, id);
            }
            Payload::Scalar(_) => unreachable!("attach to scalar"),
        }
        self.rev += 1;
        self.structure_rev += 1;
        self.view_rev += 1;
    }

    /// Detach a child from its parent. The subtree stays in the arena so the
    /// command history can re-attach it; memory is reclaimed when the
    /// document closes.
    pub fn detach(&mut self, parent: NodeId, index: usize) -> NodeId {
        let id = match &mut self.node_mut(parent).payload {
            Payload::Object(c) | Payload::Array(c) => c.remove(index),
            Payload::Scalar(_) => unreachable!("detach from scalar"),
        };
        self.node_mut(id).parent = None;
        self.rev += 1;
        self.structure_rev += 1;
        self.view_rev += 1;
        id
    }

    pub fn move_child(&mut self, parent: NodeId, from: usize, to: usize) {
        if let Payload::Object(c) | Payload::Array(c) = &mut self.node_mut(parent).payload {
            if from < c.len() && to < c.len() {
                let id = c.remove(from);
                c.insert(to, id);
            }
        }
        self.rev += 1;
        self.structure_rev += 1;
        self.view_rev += 1;
    }

    /// Swap the document root (used by the text pane's Apply). The previous
    /// root subtree stays in the arena for undo.
    pub fn set_root(&mut self, id: NodeId) {
        self.root = id;
        self.node_mut(id).parent = None;
        self.node_mut(id).expanded = true;
        self.rev += 1;
        self.structure_rev += 1;
        self.view_rev += 1;
    }

    pub fn index_in_parent(&self, id: NodeId) -> Option<(NodeId, usize)> {
        let parent = self.node(id).parent?;
        let index = self.children(parent).iter().position(|&c| c == id)?;
        Some((parent, index))
    }

    pub fn set_expanded(&mut self, id: NodeId, expanded: bool) {
        if self.node(id).expanded != expanded {
            self.node_mut(id).expanded = expanded;
            self.view_rev += 1;
        }
    }

    pub fn expand_all(&mut self, expanded: bool) {
        for node in &mut self.nodes {
            node.expanded = expanded;
        }
        if !expanded {
            let root = self.root;
            self.node_mut(root).expanded = true;
        }
        self.view_rev += 1;
    }

    /// Expand every ancestor of `id` so it becomes visible.
    pub fn reveal(&mut self, id: NodeId) {
        let mut cur = self.node(id).parent;
        while let Some(c) = cur {
            self.node_mut(c).expanded = true;
            cur = self.node(c).parent;
        }
        self.view_rev += 1;
    }

    // ---- Conversion back to values ----

    pub fn to_value(&self) -> KvValue {
        self.subtree_to_value(self.root)
    }

    pub fn subtree_to_value(&self, id: NodeId) -> KvValue {
        let node = self.node(id);
        let value = match &node.payload {
            Payload::Scalar(s) => scalar_to_value(s),
            Payload::Array(children) => {
                KvValue::Array(children.iter().map(|&c| self.subtree_to_value(c)).collect())
            }
            Payload::Object(children) => KvValue::Object(
                children
                    .iter()
                    .map(|&c| (self.node(c).key.clone(), self.subtree_to_value(c)))
                    .collect(),
            ),
        };
        if node.subclass {
            KvValue::Subclass(Box::new(value))
        } else {
            value
        }
    }

    /// Counts of (objects, arrays, scalar properties, comments) for the
    /// status bar, considering only attached nodes.
    pub fn stats(&self) -> DocStats {
        let mut stats = DocStats::default();
        let mut stack = vec![self.root];
        while let Some(id) = stack.pop() {
            match &self.node(id).payload {
                Payload::Object(c) => {
                    stats.objects += 1;
                    stack.extend_from_slice(c);
                }
                Payload::Array(c) => {
                    stats.arrays += 1;
                    stack.extend_from_slice(c);
                }
                Payload::Scalar(Scalar::Comment(_)) => stats.comments += 1,
                Payload::Scalar(_) => stats.properties += 1,
            }
        }
        stats
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DocStats {
    pub objects: usize,
    pub arrays: usize,
    pub properties: usize,
    pub comments: usize,
}

impl DocStats {
    pub fn total(&self) -> usize {
        self.objects + self.arrays + self.properties + self.comments
    }
}

pub fn scalar_to_value(s: &Scalar) -> KvValue {
    match s {
        Scalar::Null => KvValue::Null,
        Scalar::Bool(b) => KvValue::Bool(*b),
        Scalar::Int(v) => KvValue::Int(*v),
        Scalar::Double(v) => KvValue::Double(*v),
        Scalar::Str(s) => KvValue::String(s.clone()),
        Scalar::Typed { kind, value } => KvValue::Typed {
            kind: kind.clone(),
            value: value.clone(),
        },
        Scalar::Comment(text) => KvValue::Comment(text.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> KvValue {
        kv3::parse_value_text(
            r#"{
                name = "test"
                count = 3
                items = [1, 2, 3]
                nested = { a = true b = subclass: { _class = "x" } }
            }"#,
        )
    }

    #[test]
    fn round_trips_through_arena() {
        let value = sample();
        let model = DocModel::from_value(&value);
        assert_eq!(model.to_value(), value);
    }

    #[test]
    fn detach_attach_round_trip() {
        let value = sample();
        let mut model = DocModel::from_value(&value);
        let root = model.root();
        let id = model.detach(root, 1);
        assert_ne!(model.to_value(), value);
        model.attach(root, 1, id);
        assert_eq!(model.to_value(), value);
    }

    #[test]
    fn stats_counts_attached_nodes() {
        let model = DocModel::from_value(&sample());
        let stats = model.stats();
        assert_eq!(stats.objects, 3); // root, nested, subclass object
        assert_eq!(stats.arrays, 1);
        assert_eq!(stats.properties, 7); // name count 1 2 3 a _class
    }

    #[test]
    fn labels_and_paths() {
        let model = DocModel::from_value(&sample());
        let root = model.root();
        let items = model.children(root)[2];
        let second = model.children(items)[1];
        assert_eq!(model.label(second), "[1]");
        assert_eq!(model.path(second), "root.items[1]");
    }
}
