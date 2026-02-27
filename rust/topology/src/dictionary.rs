// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Typed key-value metadata that can be attached to any topology entity.

use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

use crate::arena::TopologyArena;
use crate::keys::TopologyKey;

/// A typed value stored in a dictionary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DictValue {
    Int(i64),
    Double(f64),
    String(String),
    List(Vec<DictValue>),
}

/// A dictionary is a typed key-value map attached to a topology entity.
pub type Dictionary = FxHashMap<String, DictValue>;

impl TopologyArena {
    /// Attaches a dictionary to a topology entity, replacing any existing one.
    pub fn set_dictionary(&mut self, key: TopologyKey, dict: Dictionary) {
        self.dictionaries.insert(key, dict);
    }

    /// Returns the dictionary attached to a topology entity, if any.
    pub fn get_dictionary(&self, key: TopologyKey) -> Option<&Dictionary> {
        self.dictionaries.get(&key)
    }

    /// Returns a mutable reference to the dictionary, creating an empty one if needed.
    pub fn get_dictionary_mut(&mut self, key: TopologyKey) -> &mut Dictionary {
        self.dictionaries.entry(key).or_default()
    }

    /// Removes the dictionary from a topology entity.
    pub fn remove_dictionary(&mut self, key: TopologyKey) -> Option<Dictionary> {
        self.dictionaries.remove(&key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get_dictionary() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(0.0, 0.0, 0.0);
        let key = TopologyKey::Vertex(vk);

        let mut dict = Dictionary::default();
        dict.insert("name".to_string(), DictValue::String("origin".to_string()));
        dict.insert("weight".to_string(), DictValue::Double(1.5));
        dict.insert("id".to_string(), DictValue::Int(42));

        arena.set_dictionary(key, dict);

        let retrieved = arena.get_dictionary(key).unwrap();
        assert_eq!(
            retrieved.get("name"),
            Some(&DictValue::String("origin".to_string()))
        );
        assert_eq!(retrieved.get("weight"), Some(&DictValue::Double(1.5)));
        assert_eq!(retrieved.get("id"), Some(&DictValue::Int(42)));
    }

    #[test]
    fn dictionary_not_found() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(0.0, 0.0, 0.0);
        assert!(arena.get_dictionary(TopologyKey::Vertex(vk)).is_none());
    }

    #[test]
    fn get_dictionary_mut_creates_empty() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(0.0, 0.0, 0.0);
        let key = TopologyKey::Vertex(vk);

        let dict = arena.get_dictionary_mut(key);
        dict.insert("hello".to_string(), DictValue::String("world".to_string()));

        let retrieved = arena.get_dictionary(key).unwrap();
        assert_eq!(
            retrieved.get("hello"),
            Some(&DictValue::String("world".to_string()))
        );
    }

    #[test]
    fn remove_dictionary() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(0.0, 0.0, 0.0);
        let key = TopologyKey::Vertex(vk);

        let mut dict = Dictionary::default();
        dict.insert("x".to_string(), DictValue::Int(1));
        arena.set_dictionary(key, dict);

        let removed = arena.remove_dictionary(key).unwrap();
        assert_eq!(removed.get("x"), Some(&DictValue::Int(1)));
        assert!(arena.get_dictionary(key).is_none());
    }

    #[test]
    fn nested_list_values() {
        let list = DictValue::List(vec![
            DictValue::Int(1),
            DictValue::Double(2.0),
            DictValue::String("three".to_string()),
            DictValue::List(vec![DictValue::Int(4)]),
        ]);

        if let DictValue::List(items) = &list {
            assert_eq!(items.len(), 4);
            assert_eq!(items[0], DictValue::Int(1));
        } else {
            panic!("expected list");
        }
    }
}
