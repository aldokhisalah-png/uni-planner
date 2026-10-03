// Fall 2026 starting data, taken from the registration schedule, the five syllabi and the AUM
// academic calendar. Loaded into your account the first time you sign in; edit it in the app after that.

export const SEED_SETTINGS = {
  tz_offset_min: 180,
  class_leads: [60, 30],
  day_before_time: '20:00',
  term_start: '2026-09-20',
  term_end: '2027-01-14',
  // No regular classes: midterm exam week, winter break, New Year, Israa & Mi'raj (tentative).
  skip_dates: [
    '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
    '2026-12-20', '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24',
    '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
    '2027-01-05'
  ]
};

// weekday: 0 = Sunday … 4 = Thursday
export const SEED_CLASSES = [
  ['CE 462', 'Lab', 0, '13:00', '14:40', 'B1-B-06', 'Konstantinos Koutras'],
  ['CE 337', 'Lecture', 0, '16:00', '16:50', 'E2-G-01', 'Julian Hoxha'],
  ['MA 265', 'Lecture', 0, '17:00', '18:15', 'B2-F-02', 'Ghaylen Laouini'],
  ['CE 337', 'Lab', 1, '08:30', '11:00', 'E2-F-03', 'Ali Alsarraf'],
  ['BIOL 110', 'Lecture', 1, '13:00', '14:15', 'B2-F-08', 'Gabriel Haddad'],
  ['CE 468', 'Lecture', 1, '16:30', '17:45', 'E1-G-04', 'Julian Hoxha'],
  ['CE 400', 'Lecture', 2, '10:00', '10:50', 'E2-G-04', 'Mutaz Al-Tarawneh'],
  ['CE 400', 'Lab', 2, '11:00', '11:50', 'B2-CREATE', 'Hossam Omar'],
  ['CE 462', 'Lecture', 2, '12:30', '14:10', 'B2-F-03', 'Rami Halloush'],
  ['MA 265', 'Lecture', 2, '17:00', '18:15', 'B2-F-02', 'Ghaylen Laouini'],
  ['BIOL 110', 'Lecture', 3, '13:00', '14:15', 'B2-F-08', 'Gabriel Haddad'],
  ['CE 468', 'Lecture', 3, '16:30', '17:45', 'E1-G-04', 'Julian Hoxha'],
  ['BIOL 110', 'Lab', 4, '08:30', '10:10', 'E2-G-02', 'Eman Olayan'],
  ['CE 468', 'Lab', 4, '18:00', '19:40', 'B2-B-AI', 'Hamzeh Kassan']
].map(([course, kind, weekday, start_time, end_time, room, instructor]) => ({ course, kind, weekday, start_time, end_time, room, instructor }));

// [date, time or null for all-day, course, title, kind, weight, note]
const E = [
  ['2026-10-05', '08:30', 'CE 337', 'Graded Lab 1', 'lab', '15%', 'Monday lab'],
  ['2026-10-06', '15:00', 'BIOL 110', 'Lab safety quiz opens', 'info', '', 'Moodle'],
  ['2026-10-07', '15:00', 'BIOL 110', 'Lab safety quiz closes', 'quiz', '2.5%', 'Moodle'],
  ['2026-10-08', '08:30', 'BIOL 110', 'Pre-lab assignment 1', 'prelab', '', 'Moodle, submit within 24 h before lab, no late submission'],
  ['2026-10-08', '08:30', 'BIOL 110', 'Graded Lab 1: Scientific measurements', 'lab', '4%', ''],
  ['2026-10-12', '08:30', 'CE 337', 'Project announcement', 'info', '', 'Monday lab'],
  ['2026-10-14', '20:00', 'MA 265', 'Assignment opens', 'info', '', 'Moodle'],
  ['2026-10-18', '13:00', 'CE 462', 'Graded Lab 1', 'lab', '5%', ''],
  ['2026-10-18', '13:00', 'CE 462', 'Moodle quiz', 'quiz', '5%', 'Syllabus says week of 18 Oct. Check the exact day on Moodle'],
  ['2026-10-19', '23:59', 'MA 265', 'Assignment', 'assignment', '15%', 'Moodle'],
  ['2026-10-21', '13:00', 'BIOL 110', 'GCA 1', 'gca', '10%', ''],
  ['2026-10-22', '18:00', 'CE 468', 'Graded Lab 1', 'lab', '5%', ''],
  ['2026-10-26', '08:30', 'CE 337', 'Graded Lab 2', 'lab', '15%', ''],
  ['2026-10-27', '12:30', 'CE 462', 'GCA 1', 'gca', '10%', 'Pairs'],
  ['2026-10-27', '17:00', 'MA 265', 'GCA 1', 'gca', '15%', ''],
  ['2026-10-28', '16:30', 'CE 468', 'GCA 1', 'gca', '10%', ''],
  ['2026-10-29', '08:30', 'BIOL 110', 'Pre-lab assignment 2', 'prelab', '', 'Moodle, submit within 24 h before lab'],
  ['2026-10-29', '08:30', 'BIOL 110', 'Graded Lab 2: Scientific methods', 'lab', '4%', ''],
  ['2026-11-05', '18:00', 'CE 468', 'Graded Lab 2', 'lab', '5%', ''],
  ['2026-11-07', null, 'AUM', 'Midterm exams week (7–14 Nov)', 'academic', '', 'Add each midterm with its date and time once announced'],
  ['2026-11-16', '08:30', 'CE 337', 'Graded Lab 3', 'lab', '15%', ''],
  ['2026-11-19', '08:30', 'BIOL 110', 'Pre-lab assignment 3', 'prelab', '', 'Moodle, submit within 24 h before lab'],
  ['2026-11-19', '08:30', 'BIOL 110', 'Graded Lab 3: Cellular respiration', 'lab', '4%', ''],
  ['2026-11-22', '13:00', 'CE 462', 'Graded Lab 2', 'lab', '5%', ''],
  ['2026-11-25', '13:00', 'BIOL 110', 'GCA 2', 'gca', '10%', ''],
  ['2026-11-26', '18:00', 'CE 468', 'Graded Lab 3', 'lab', '5%', ''],
  ['2026-11-29', '08:00', 'BIOL 110', 'Moodle assignment opens', 'info', '', ''],
  ['2026-12-01', '12:30', 'CE 462', 'GCA 2', 'gca', '10%', 'Pairs'],
  ['2026-12-01', '17:00', 'MA 265', 'GCA 2', 'gca', '15%', ''],
  ['2026-12-02', '16:30', 'CE 468', 'GCA 2', 'gca', '10%', ''],
  ['2026-12-06', '13:00', 'CE 462', 'Graded Lab 3', 'lab', '5%', ''],
  ['2026-12-06', '16:00', 'CE 337', 'GCA', 'gca', '10%', 'Individual'],
  ['2026-12-06', '23:59', 'BIOL 110', 'Moodle assignment', 'assignment', '10%', 'Closes 6 Dec'],
  ['2026-12-07', '08:30', 'CE 337', 'Graded Lab 4', 'lab', '15%', ''],
  ['2026-12-07', '20:00', 'MA 265', 'Moodle quiz opens', 'info', '', ''],
  ['2026-12-08', '20:00', 'MA 265', 'Moodle quiz', 'quiz', '5%', 'Closes 8:00 pm'],
  ['2026-12-10', '08:30', 'BIOL 110', 'Pre-lab assignment 4', 'prelab', '', 'Moodle, submit within 24 h before lab'],
  ['2026-12-10', '08:30', 'BIOL 110', 'Graded Lab 4: Osmosis & diffusion', 'lab', '4%', ''],
  ['2026-12-10', '18:00', 'CE 468', 'Graded Lab 4', 'lab', '5%', ''],
  ['2026-12-10', null, 'AUM', 'Last day for course withdrawal', 'academic', '', ''],
  ['2026-12-13', '13:00', 'CE 462', 'Graded Lab 4', 'lab', '5%', ''],
  ['2026-12-14', '08:30', 'CE 337', 'Graded Lab 5', 'lab', '5%', ''],
  ['2026-12-14', '08:30', 'CE 337', 'Project submission (PD1)', 'project', '10%', 'Group'],
  ['2026-12-17', '08:30', 'BIOL 110', 'Pre-lab assignment 5', 'prelab', '', 'Moodle, submit within 24 h before lab'],
  ['2026-12-17', '08:30', 'BIOL 110', 'Graded Lab 5: DNA extraction', 'lab', '4%', ''],
  ['2026-12-20', null, 'AUM', 'Winter break (20–31 Dec)', 'academic', '', ''],
  ['2027-01-03', '13:00', 'CE 462', 'Project submission & interview', 'project', '10%', 'Syllabus says week of 3 Jan. Confirm the day with your instructor'],
  ['2027-01-04', '08:30', 'CE 337', 'Project Q&A (PD2)', 'project', '10%', 'Group'],
  ['2027-01-05', null, 'AUM', "Israa & Mi'raj holiday (tentative)", 'academic', '', ''],
  ['2027-01-07', '18:00', 'CE 468', 'Project PD1 + interview', 'project', '10%', ''],
  ['2027-01-14', null, 'AUM', 'Classes end', 'academic', '', ''],
  ['2027-01-16', null, 'AUM', 'Final exams (16–24 Jan)', 'academic', '', 'Add each final with its date and time once announced'],
  ['2027-01-27', null, 'AUM', 'Final grades announced', 'academic', '', '']
];

export const SEED_EVENTS = E.map(([date, time, course, title, kind, weight, note]) => ({
  course, title, kind, weight: weight || null, note: note || null,
  all_day: !time, due_at: `${date}T${time || '00:00'}:00+03:00`, remind: kind !== 'info' && kind !== 'academic'
}));
