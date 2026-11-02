// ЕДИНСТВЕННОЕ место, где описаны переходы статусов заявки (SPEC §6.1).
export const ACTIVE = ['submitted', 'shortlisted', 'interview', 'offer'];
export const TERMINAL = ['accepted', 'declined', 'rejected', 'withdrawn'];

export const TRANSITIONS = {
  // Компания двигает заявку по воронке (PATCH /api/company/applications/:id)
  company: {
    submitted: ['shortlisted', 'rejected'],
    shortlisted: ['rejected'],           // в interview заявку переводит бронь слота студентом (T2)
    interview: ['offer', 'rejected'],
  },
  // Студент: бронь слота (T2), оффер (T3, отказ) и отзыв заявки
  student: {
    submitted: ['withdrawn'],
    shortlisted: ['interview', 'withdrawn'],
    interview: ['withdrawn'],
    offer: ['accepted', 'declined', 'withdrawn'],
  },
};

export function canMove(actor, from, to) {
  return (TRANSITIONS[actor][from] || []).includes(to);
}
