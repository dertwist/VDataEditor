//! Undo/redo command history.
//!
//! Every edit is a [`Cmd`] with enough information to apply and revert
//! itself against the arena. Detached subtrees referenced by commands stay
//! alive in the arena, so node ids in older commands remain valid.

use std::time::{Duration, Instant};

use crate::model::{DocModel, NodeId, Payload};

const MAX_UNDO_STEPS: usize = 200;
/// Rapid edits to the same node merge into a single undo entry.
const COALESCE_WINDOW: Duration = Duration::from_millis(700);

#[derive(Debug, Clone)]
pub enum Cmd {
    SetPayload {
        id: NodeId,
        old: Payload,
        new: Payload,
    },
    SetSubclass {
        id: NodeId,
        old: bool,
        new: bool,
    },
    Rename {
        id: NodeId,
        old: String,
        new: String,
    },
    /// Attach an existing (detached) subtree.
    Insert {
        parent: NodeId,
        index: usize,
        id: NodeId,
    },
    /// Detach a subtree (kept in the arena for undo).
    Remove {
        parent: NodeId,
        index: usize,
        id: NodeId,
    },
    Move {
        parent: NodeId,
        from: usize,
        to: usize,
    },
    /// Swap the document root (text-pane Apply). Both subtrees stay in the
    /// arena, so ids in older commands remain valid.
    ReplaceRoot {
        old: NodeId,
        new: NodeId,
    },
    Batch(Vec<Cmd>),
}

impl Cmd {
    pub fn apply(&self, model: &mut DocModel) {
        match self {
            Cmd::SetPayload { id, new, .. } => {
                model.set_payload(*id, new.clone());
            }
            Cmd::SetSubclass { id, new, .. } => {
                model.set_subclass(*id, *new);
            }
            Cmd::Rename { id, new, .. } => {
                model.rename(*id, new.clone());
            }
            Cmd::Insert { parent, index, id } => model.attach(*parent, *index, *id),
            Cmd::Remove { parent, index, .. } => {
                model.detach(*parent, *index);
            }
            Cmd::Move { parent, from, to } => model.move_child(*parent, *from, *to),
            Cmd::ReplaceRoot { new, .. } => model.set_root(*new),
            Cmd::Batch(cmds) => cmds.iter().for_each(|c| c.apply(model)),
        }
    }

    pub fn revert(&self, model: &mut DocModel) {
        match self {
            Cmd::SetPayload { id, old, .. } => {
                model.set_payload(*id, old.clone());
            }
            Cmd::SetSubclass { id, old, .. } => {
                model.set_subclass(*id, *old);
            }
            Cmd::Rename { id, old, .. } => {
                model.rename(*id, old.clone());
            }
            Cmd::Insert { parent, index, .. } => {
                model.detach(*parent, *index);
            }
            Cmd::Remove { parent, index, id } => model.attach(*parent, *index, *id),
            Cmd::Move { parent, from, to } => model.move_child(*parent, *to, *from),
            Cmd::ReplaceRoot { old, .. } => model.set_root(*old),
            Cmd::Batch(cmds) => cmds.iter().rev().for_each(|c| c.revert(model)),
        }
    }
}

struct Entry {
    cmd: Cmd,
    label: String,
    time: Instant,
}

#[derive(Default)]
pub struct History {
    undo: Vec<Entry>,
    redo: Vec<Entry>,
}

impl History {
    /// Apply a command and record it.
    pub fn push(&mut self, model: &mut DocModel, cmd: Cmd, label: impl Into<String>) {
        cmd.apply(model);
        self.redo.clear();

        // Coalesce rapid scalar edits (slider scrubs, typing) on one node.
        if let Cmd::SetPayload { id, new, .. } = &cmd {
            if let Some(last) = self.undo.last_mut() {
                if let Cmd::SetPayload {
                    id: last_id,
                    new: last_new,
                    ..
                } = &mut last.cmd
                {
                    if *last_id == *id
                        && last.time.elapsed() < COALESCE_WINDOW
                        && matches!(last_new, Payload::Scalar(_))
                        && matches!(new, Payload::Scalar(_))
                    {
                        *last_new = new.clone();
                        last.time = Instant::now();
                        return;
                    }
                }
            }
        }

        self.undo.push(Entry {
            cmd,
            label: label.into(),
            time: Instant::now(),
        });
        if self.undo.len() > MAX_UNDO_STEPS {
            self.undo.remove(0);
        }
    }

    pub fn undo(&mut self, model: &mut DocModel) -> Option<String> {
        let entry = self.undo.pop()?;
        entry.cmd.revert(model);
        let label = entry.label.clone();
        self.redo.push(entry);
        Some(label)
    }

    pub fn redo(&mut self, model: &mut DocModel) -> Option<String> {
        let entry = self.redo.pop()?;
        entry.cmd.apply(model);
        let label = entry.label.clone();
        self.undo.push(entry);
        Some(label)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn undo_label(&self) -> Option<&str> {
        self.undo.last().map(|e| e.label.as_str())
    }

    pub fn redo_label(&self) -> Option<&str> {
        self.redo.last().map(|e| e.label.as_str())
    }

    pub fn depth(&self) -> usize {
        self.undo.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Scalar;

    fn model() -> DocModel {
        DocModel::from_value(&kv3::parse_value_text(
            "{ a = 1\n b = \"two\"\n c = [1, 2] }",
        ))
    }

    #[test]
    fn undo_redo_set_payload() {
        let mut m = model();
        let mut h = History::default();
        let a = m.children(m.root())[0];
        let old = m.node(a).payload.clone();
        h.push(
            &mut m,
            Cmd::SetPayload {
                id: a,
                old: old.clone(),
                new: Payload::Scalar(Scalar::Int(42)),
            },
            "Edit a",
        );
        assert_eq!(m.node(a).payload, Payload::Scalar(Scalar::Int(42)));
        h.undo(&mut m);
        assert_eq!(m.node(a).payload, old);
        h.redo(&mut m);
        assert_eq!(m.node(a).payload, Payload::Scalar(Scalar::Int(42)));
    }

    #[test]
    fn undo_redo_remove_preserves_subtree() {
        let mut m = model();
        let mut h = History::default();
        let before = m.to_value();
        let root = m.root();
        let c = m.children(root)[2];
        h.push(
            &mut m,
            Cmd::Remove {
                parent: root,
                index: 2,
                id: c,
            },
            "Delete c",
        );
        assert_eq!(m.children(m.root()).len(), 2);
        h.undo(&mut m);
        assert_eq!(m.to_value(), before);
        assert!(h.can_redo());
    }

    #[test]
    fn rapid_scalar_edits_coalesce() {
        let mut m = model();
        let mut h = History::default();
        let a = m.children(m.root())[0];
        for i in 0..10 {
            let old = m.node(a).payload.clone();
            h.push(
                &mut m,
                Cmd::SetPayload {
                    id: a,
                    old,
                    new: Payload::Scalar(Scalar::Int(i)),
                },
                "Edit a",
            );
        }
        assert_eq!(h.depth(), 1, "rapid edits should merge into one entry");
        h.undo(&mut m);
        assert_eq!(m.node(a).payload, Payload::Scalar(Scalar::Int(1)));
    }

    #[test]
    fn batch_round_trips() {
        let mut m = model();
        let mut h = History::default();
        let before = m.to_value();
        let a = m.children(m.root())[0];
        let b = m.children(m.root())[1];
        let a_old = m.node(a).payload.clone();
        h.push(
            &mut m,
            Cmd::Batch(vec![
                Cmd::SetPayload {
                    id: a,
                    old: a_old,
                    new: Payload::Scalar(Scalar::Int(10)),
                },
                Cmd::Rename {
                    id: b,
                    old: "b".into(),
                    new: "renamed".into(),
                },
            ]),
            "Multi edit",
        );
        assert_eq!(m.node(b).key, "renamed");
        h.undo(&mut m);
        assert_eq!(m.to_value(), before);
    }
}
