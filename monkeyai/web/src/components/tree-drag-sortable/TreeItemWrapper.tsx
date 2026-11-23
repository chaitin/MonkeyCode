import clsx from 'clsx';
import React, { forwardRef } from 'react';
import './index.css';
import type { TreeItemComponentProps } from './types';

export const TreeItemWrapper = forwardRef<
  HTMLDivElement,
  React.PropsWithChildren<TreeItemComponentProps<{}>>
>((props, ref) => {
  const {
    clone,
    depth,
    disableSelection,
    disableInteraction,
    disableSorting,
    ghost,
    handleProps,
    indentationWidth,
    indicator,
    collapsed,
    onCollapse,
    onRemove,
    item,
    wrapperRef,
    style,
    hideCollapseButton,
    childCount,
    manualDrag,
    showDragHandle,
    disableCollapseOnItemClick,
    isLast,
    parent,
    className,
    contentClassName,
    isOver,
    isOverParent,
    ...rest
  } = props;

  return (
    <li
      ref={wrapperRef}
      {...rest}
      className={clsx(
        'dnd-sortable-tree_simple_wrapper',
        clone && 'dnd-sortable-tree_simple_clone',
        ghost && 'dnd-sortable-tree_simple_ghost',
        disableSelection && 'dnd-sortable-tree_simple_disable-selection',
        disableInteraction && 'dnd-sortable-tree_simple_disable-interaction',
        className,
      )}
      data-tree-item-id={item.id}
      style={{
        ...style,
        paddingLeft: clone ? indentationWidth : indentationWidth * depth,
      }}
    >
      <div
        className={clsx('dnd-sortable-tree_simple_tree-item', contentClassName)}
        ref={ref}
        {...(manualDrag ? undefined : handleProps)}
        onClick={disableCollapseOnItemClick ? undefined : onCollapse}
      >
        {!disableSorting && showDragHandle !== false && (
          <div className={'dnd-sortable-tree_simple_handle'} {...handleProps} />
        )}
        {!manualDrag && !hideCollapseButton && !!onCollapse && !!childCount && (
          <button
            onClick={e => {
              if (!disableCollapseOnItemClick) {
                return;
              }
              e.preventDefault();
              onCollapse?.();
            }}
            className={clsx(
              'dnd-sortable-tree_simple_tree-item-collapse_button',
              collapsed &&
                'dnd-sortable-tree_folder_simple-item-collapse_button-collapsed',
            )}
          />
        )}
        {props.children}
      </div>
    </li>
  );
}) as <T>(
  p: React.PropsWithChildren<
    TreeItemComponentProps<T> & React.RefAttributes<HTMLDivElement>
  >,
) => React.ReactElement;
