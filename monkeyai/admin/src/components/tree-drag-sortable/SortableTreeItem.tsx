import { useSortable } from '@dnd-kit/sortable';
import type { AnimateLayoutChanges, UseSortableArguments } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useMemo, type CSSProperties, type HTMLAttributes } from 'react';

import type { UniqueIdentifier } from '@dnd-kit/core';
import type { FlattenedItem, TreeItem, TreeItemComponentType } from './types';
import { getIsOverParent, iOS } from './utilities';

export interface TreeItemProps<T> extends HTMLAttributes<HTMLLIElement> {
  childCount?: number;
  clone?: boolean;
  collapsed?: boolean;
  depth: number;
  disableInteraction?: boolean;
  disableSelection?: boolean;
  ghost?: boolean;
  handleProps?: any;
  indicator?: boolean;
  indentationWidth: number;
  item: TreeItem<T>;
  isLast: boolean;
  parent: FlattenedItem<T> | null;
  onCollapse?(id: UniqueIdentifier): void;

  onRemove?(id: UniqueIdentifier): void;

  wrapperRef?(node: HTMLLIElement): void;
}

const animateLayoutChanges: AnimateLayoutChanges = ({
  isSorting,
  isDragging,
}) => (isSorting || isDragging ? false : true);

type SortableTreeItemProps<
  T,
  TElement extends HTMLElement,
> = TreeItemProps<T> & {
  id: string;
  TreeItemComponent: TreeItemComponentType<T, TElement>;
  disableSorting?: boolean;
  sortableProps?: Omit<UseSortableArguments, 'id'>;
  keepGhostInPlace?: boolean;
};

const SortableTreeItemNotMemoized = function SortableTreeItem<
  T,
  TElement extends HTMLElement,
>({
  id,
  depth,
  isLast,
  TreeItemComponent,
  parent,
  disableSorting,
  sortableProps,
  keepGhostInPlace,
  ...props
}: SortableTreeItemProps<T, TElement>) {
  const {
    attributes,
    isDragging,
    isSorting,
    listeners,
    setDraggableNodeRef,
    setDroppableNodeRef,
    transform,
    transition,
    isOver,
    over,
  } = useSortable({
    id,
    animateLayoutChanges,
    disabled: disableSorting,
    ...sortableProps,
  });
  const isOverParent = useMemo(
    () => !!over?.id && getIsOverParent(parent, over.id),
    [over?.id],
  );
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined,
  };
  const localCollapse = useMemo(() => {
    if (!props.onCollapse) return undefined;
    return () => props.onCollapse?.(props.item.id);
  }, [props.item.id, props.onCollapse]);

  const localRemove = useMemo(() => {
    if (!props.onRemove) return undefined;

    return () => props.onRemove?.(props.item.id);
  }, [props.item.id, props.onRemove]);
  return (
    <TreeItemComponent
      {...props}
      ref={setDraggableNodeRef}
      wrapperRef={setDroppableNodeRef}
      style={keepGhostInPlace ? undefined : style}
      depth={depth}
      ghost={isDragging}
      disableSelection={iOS}
      disableInteraction={isSorting}
      isLast={isLast}
      parent={parent}
      handleProps={{
        ...attributes,
        ...listeners,
      }}
      onCollapse={localCollapse}
      onRemove={localRemove}
      disableSorting={disableSorting}
      isOver={isOver}
      isOverParent={isOverParent}
    />
  );
};

export const SortableTreeItem = React.memo(
  SortableTreeItemNotMemoized,
) as typeof SortableTreeItemNotMemoized;
