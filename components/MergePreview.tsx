'use client'

import { useState } from 'react'

interface Contact {
  id: string
  name?: string
  company?: string
  role?: string
  email?: string
  phone?: string
  website?: string
  instagram?: string
  personal_notes?: string
  [key: string]: any
}

interface Props {
  contactA?: Contact
  contactB?: Contact
  onConfirm?: (overrides: Record<string, any>) => void
  onCancel?: () => void
  onClose?: () => void
}

const DISPLAY_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company' },
  { key: 'role', label: 'Role' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'website', label: 'Website' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'personal_notes', label: 'Notes' },
]

export default function MergePreview({
  contactA,
  contactB,
  onConfirm,
  onCancel,
  onClose,
}: Props) {
  const [merged, setMerged] = useState<Record<string, any>>(
    () => {
      if (!contactA || !contactB) return {}
      const result: Record<string, any> = {}
      DISPLAY_FIELDS.forEach(({ key }) => {
        result[key] = contactA[key] || contactB[key]
      })
      return result
    }
  )

  const handleFieldClick = (fieldKey: string) => {
    const valueA = contactA?.[fieldKey]
    const valueB = contactB?.[fieldKey]
    const current = merged[fieldKey]

    // Cycle: A -> B -> neither -> A
    if (current === valueA) {
      setMerged((prev) => ({ ...prev, [fieldKey]: valueB || '' }))
    } else if (current === valueB) {
      setMerged((prev) => ({ ...prev, [fieldKey]: '' }))
    } else {
      setMerged((prev) => ({ ...prev, [fieldKey]: valueA || '' }))
    }
  }

  const handleConfirm = () => {
    const overrides: Record<string, any> = {}
    DISPLAY_FIELDS.forEach(({ key }) => {
      if (merged[key] !== (contactA?.[key] || '')) {
        overrides[key] = merged[key]
      }
    })
    onConfirm?.(overrides)
    onClose?.()
  }

  if (!contactA || !contactB) {
    return (
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full shadow-xl">
        <p className="text-center text-gray-500">Loading contacts...</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-xl max-h-96 overflow-y-auto w-full max-w-4xl">
      {/* Header */}
      <div className="sticky top-0 bg-gray-50 border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Merge Contacts</h2>
        <button
          onClick={() => onClose?.()}
          className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
        >
          ×
        </button>
      </div>

      {/* Comparison Table */}
      <div className="p-6">
        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Contact A Header */}
          <div className="text-center">
            <h3 className="font-semibold text-gray-700 text-sm">{contactA.name || 'Contact A'}</h3>
            <p className="text-xs text-gray-400">{contactA.company}</p>
          </div>

          {/* Merged Header */}
          <div className="text-center">
            <h3 className="font-semibold text-amber-700 text-sm">Merged Result</h3>
            <p className="text-xs text-amber-400">(click to switch values)</p>
          </div>

          {/* Contact B Header */}
          <div className="text-center">
            <h3 className="font-semibold text-gray-700 text-sm">{contactB.name || 'Contact B'}</h3>
            <p className="text-xs text-gray-400">{contactB.company}</p>
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          {DISPLAY_FIELDS.map(({ key, label }) => {
            const valueA = contactA[key]
            const valueB = contactB[key]
            const current = merged[key]
            const isCurrent = current === valueA ? 'a' : current === valueB ? 'b' : 'neither'

            return (
              <div key={key} className="grid grid-cols-3 gap-4 items-start">
                {/* Contact A Value */}
                <div className="text-sm">
                  <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
                  <p className="text-gray-800 truncate">{valueA || '—'}</p>
                </div>

                {/* Merged Value (Editable) */}
                <div
                  onClick={() => handleFieldClick(key)}
                  className={`text-sm cursor-pointer rounded-lg p-2 transition-colors ${
                    isCurrent === 'neither'
                      ? 'bg-gray-50 text-gray-500'
                      : 'bg-amber-100 text-amber-900 font-medium'
                  } hover:bg-amber-200 border border-amber-200`}
                >
                  <p className="truncate">{current || '—'}</p>
                </div>

                {/* Contact B Value */}
                <div className="text-sm">
                  <p className="text-xs text-gray-500 font-medium mb-1">{label}</p>
                  <p className="text-gray-800 truncate">{valueB || '—'}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex gap-3 justify-end">
        <button
          onClick={() => onCancel?.()}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors"
        >
          Confirm Merge
        </button>
      </div>
    </div>
  )
}
