import { verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { SortingStrategy } from '@dnd-kit/sortable';
export const customListSortingStrategy = (
  isValid: (activeIndex: any, overIndex: any) => boolean,
): SortingStrategy => {
  const sortingStrategy: SortingStrategy = ({
    activeIndex,
    activeNodeRect,
    index,
    rects,
    overIndex,
  }) => {
    if (isValid(activeIndex, overIndex)) {
      return verticalListSortingStrategy({
        activeIndex,
        activeNodeRect,
        index,
        rects,
        overIndex,
      });
    }
    return null;
  };
  return sortingStrategy;
};
