// Who may change a booking, based on how far in the past it is (venue-local dates).
//
//   Owner                         any booking, any date
//   Correctors (billing:edit,     bookings up to MANAGER_CORRECTION_DAYS days in the past
//     i.e. managers)
//   Everyone else (employees)     today and future only
//
// "Change" = cancel/reinstate, reschedule, edit details or price, change status,
// refund, or create a booking for that date. Recording a payment that is owed is
// always allowed (it adds money, it doesn't rewrite history).
// Check-in is only possible on the booking's own day, for everyone.

import { diffDays } from './time'

export const MANAGER_CORRECTION_DAYS = 7

export type LockActor = { isOwner: boolean; canCorrect: boolean }

/** How many days back this person may change bookings (Infinity for owners). */
export function correctionWindowDays(actor: LockActor): number {
  if (actor.isOwner) return Infinity
  return actor.canCorrect ? MANAGER_CORRECTION_DAYS : 0
}

/** Days between the booking's local date and today (0 = today, negative = future). */
export function daysAgo(bookingDate: string, today: string): number {
  return diffDays(bookingDate, today)
}

export function canChangeBookingOn(actor: LockActor, bookingDate: string, today: string): boolean {
  return daysAgo(bookingDate, today) <= correctionWindowDays(actor)
}

export function lockMessage(actor: LockActor): string {
  return actor.canCorrect
    ? `Bookings older than ${MANAGER_CORRECTION_DAYS} days are locked. Only the owner can change them.`
    : 'Past bookings are locked. Ask a manager or the owner to change them.'
}

export function canCheckInOn(bookingDate: string, today: string): boolean {
  return bookingDate === today
}
