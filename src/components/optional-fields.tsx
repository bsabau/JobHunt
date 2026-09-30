"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TEXT_LIMITS, WORK_MODES, WORK_MODE_LABELS, type WorkMode } from "@/lib/limits";

export interface OptionalFieldValues {
  referral: boolean;
  workMode: WorkMode | "";
  location: string;
  salary: string;
}

export const EMPTY_OPTIONAL_FIELDS: OptionalFieldValues = { referral: false, workMode: "", location: "", salary: "" };

// A Radix select item cannot have an empty value, so "not set" is its own.
const NOT_SET = "not-set";

// The optional fields of the add and edit dialogs. Only the owner sees these
// dialogs; salary is owner-only everywhere else too.
export function OptionalFieldsInputs({
  idPrefix,
  value,
  onChange
}: {
  idPrefix: string;
  value: OptionalFieldValues;
  onChange: (value: OptionalFieldValues) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-work-mode`}>Work mode</Label>
        <Select
          value={value.workMode === "" ? NOT_SET : value.workMode}
          onValueChange={(next) => onChange({ ...value, workMode: next === NOT_SET ? "" : (next as WorkMode) })}
        >
          <SelectTrigger id={`${idPrefix}-work-mode`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOT_SET}>Not set</SelectItem>
            {WORK_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {WORK_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-location`}>Location (the guest sees it)</Label>
        <Input
          id={`${idPrefix}-location`}
          value={value.location}
          onChange={(event) => onChange({ ...value, location: event.target.value })}
          maxLength={TEXT_LIMITS.location}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-salary`}>Salary (only you see it)</Label>
        <Input
          id={`${idPrefix}-salary`}
          value={value.salary}
          onChange={(event) => onChange({ ...value, salary: event.target.value })}
          maxLength={TEXT_LIMITS.salary}
          placeholder="e.g. 70–80k gross"
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-sky-500"
          checked={value.referral}
          onChange={(event) => onChange({ ...value, referral: event.target.checked })}
        />
        Came through a referral
      </label>
    </div>
  );
}
