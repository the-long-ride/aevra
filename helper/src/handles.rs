//! A generation-scoped table mapping opaque string handles to the elements a
//! `describe` walk discovered, so a later `act` (task 9c) can resolve a
//! handle back to the exact element it named.
//!
//! **Design decision (task 9b):** handles are `"<generation>:<index>"`, not a
//! UIA `RuntimeId`. A `RuntimeId` is the identifier UIA itself uses for this
//! purpose, but it is explicitly documented as not guaranteed stable across a
//! tree change -- which is exactly the failure this table exists to rule
//! out, not lean on. An index into a table that is entirely discarded and
//! rebuilt on every `describe` is simpler and unambiguous: resolving a handle
//! is a pure lookup with no OS round-trip and no way for a stale index to be
//! *coincidentally* valid.
//!
//! **What happens on a stale handle:** `resolve` embeds the generation the
//! handle was minted under and compares it against the table's current
//! generation. A handle from any earlier `describe` -- even one whose index
//! is in range for the CURRENT table, even one that would silently point at
//! a completely different element now sitting in that slot -- resolves to
//! `None`, never to that different element. This is the case the security
//! model cares about: acting on "whatever is in slot 3 now" instead of
//! refusing is precisely how a click could land on the wrong control.

pub struct HandleTable<T> {
    generation: u64,
    elements: Vec<T>,
}

impl<T> HandleTable<T> {
    pub fn new() -> Self {
        HandleTable { generation: 0, elements: Vec::new() }
    }

    /// Starts a fresh generation, discarding whatever the previous `describe`
    /// stored. Must be called once at the start of every `describe` walk,
    /// before the first `store`.
    pub fn begin_generation(&mut self) -> u64 {
        self.generation += 1;
        self.elements.clear();
        self.generation
    }

    /// Stores `element` under the current generation and returns the handle
    /// string for it. Call order determines the index, so the Nth `store`
    /// since the last `begin_generation` gets index N-1.
    pub fn store(&mut self, element: T) -> String {
        let index = self.elements.len();
        self.elements.push(element);
        format!("{}:{}", self.generation, index)
    }

    /// Resolves `handle` to its element, but ONLY when it names the CURRENT
    /// generation. Used by task 9c's `act`; kept here now (unused by
    /// `describe` itself) so the representation and its stale-handle
    /// behaviour can be decided, implemented, and unit-tested in this task
    /// rather than guessed at later.
    #[allow(dead_code)]
    pub fn resolve(&self, handle: &str) -> Option<&T> {
        let (generation_str, index_str) = handle.split_once(':')?;
        let generation: u64 = generation_str.parse().ok()?;
        if generation != self.generation {
            return None;
        }
        let index: usize = index_str.parse().ok()?;
        self.elements.get(index)
    }
}

impl<T> Default for HandleTable<T> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_table_starts_a_generation_at_one_not_zero() {
        let mut table: HandleTable<&str> = HandleTable::new();
        assert_eq!(table.begin_generation(), 1);
    }

    #[test]
    fn a_handle_resolves_to_the_element_that_produced_it() {
        let mut table = HandleTable::new();
        table.begin_generation();
        let handle = table.store("button");
        assert_eq!(table.resolve(&handle), Some(&"button"));
    }

    #[test]
    fn a_handle_from_a_previous_generation_never_resolves_even_to_a_different_element() {
        let mut table = HandleTable::new();
        table.begin_generation();
        let stale_handle = table.store("ok-button");
        // A new describe: the same slot index 0 now holds a DIFFERENT element.
        table.begin_generation();
        let _ = table.store("cancel-button");
        // The stale handle must resolve to nothing -- and specifically must
        // not resolve to "cancel-button", which now occupies index 0. This is
        // the exact case the security model cares about.
        assert_eq!(table.resolve(&stale_handle), None);
    }

    #[test]
    fn an_out_of_range_index_in_the_current_generation_resolves_to_nothing() {
        let mut table: HandleTable<&str> = HandleTable::new();
        table.begin_generation();
        assert_eq!(table.resolve("1:0"), None);
    }

    #[test]
    fn a_malformed_handle_resolves_to_nothing_rather_than_panicking() {
        let mut table: HandleTable<&str> = HandleTable::new();
        table.begin_generation();
        assert_eq!(table.resolve("not-a-handle"), None);
        assert_eq!(table.resolve(""), None);
        assert_eq!(table.resolve("1"), None);
        assert_eq!(table.resolve("one:0"), None);
    }

    #[test]
    fn resolving_never_panics_on_an_empty_table() {
        let table: HandleTable<&str> = HandleTable::new();
        assert_eq!(table.resolve("1:0"), None);
    }
}
