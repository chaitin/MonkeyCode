import { useCallback, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import {
  tableQueryParams,
  tableQueryState,
  type TableFilters,
} from "@/lib/table-query"

export function useTableQuery(keys: readonly string[], defaultSize = 50) {
  const [params, setParams] = useSearchParams()
  const rawQuery = params.toString()
  const state = useMemo(
    () => tableQueryState(rawQuery, keys, defaultSize),
    [rawQuery, keys, defaultSize]
  )
  const commit = useCallback(
    (filters: TableFilters) => {
      const next = tableQueryParams(
        rawQuery,
        keys,
        filters,
        1,
        state.pageSize,
        defaultSize
      )
      const parsed = tableQueryState(next.toString(), keys, defaultSize)
      const changed =
        parsed.filterQuery !== state.filterQuery || state.page !== 1
      if (next.toString() !== rawQuery) setParams(next)
      return changed
    },
    [
      rawQuery,
      keys,
      state.pageSize,
      state.filterQuery,
      state.page,
      defaultSize,
      setParams,
    ]
  )
  const setPage = useCallback(
    (page: number, { replace = false } = {}) => {
      const next = tableQueryParams(
        rawQuery,
        keys,
        state.filters,
        page,
        state.pageSize,
        defaultSize
      )
      if (next.toString() !== rawQuery) setParams(next, { replace })
    },
    [rawQuery, keys, state.filters, state.pageSize, defaultSize, setParams]
  )
  const setPageSize = useCallback(
    (pageSize: number) => {
      setParams(
        tableQueryParams(
          rawQuery,
          keys,
          state.filters,
          1,
          pageSize,
          defaultSize
        )
      )
    },
    [rawQuery, keys, state.filters, defaultSize, setParams]
  )
  return { ...state, params, rawQuery, commit, setPage, setPageSize }
}
