type SelectionNode = {
  id: string
  children?: SelectionNode[]
}

export function toggleKbSelection(nodes: SelectionNode[], current: string[], id: string): string[] {
  const selected = new Set(current)
  const selecting = !selected.has(id)
  const toggleSubtree = (node: SelectionNode) => {
    if (selecting) selected.add(node.id)
    else selected.delete(node.id)
    node.children?.forEach(toggleSubtree)
  }
  const visit = (items: SelectionNode[]): boolean => {
    for (const item of items) {
      if (item.id === id) {
        toggleSubtree(item)
        return true
      }
      if (visit(item.children ?? [])) {
        // An unchecked descendant must not remain covered by a selected folder.
        if (!selecting) selected.delete(item.id)
        return true
      }
    }
    return false
  }
  visit(nodes)
  return [...selected]
}
