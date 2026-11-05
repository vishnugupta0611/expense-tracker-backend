const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ScheduleEvent = require('../models/ScheduleEvent');
const mongoose = require('mongoose');
const fields = ['title', 'startTime', 'endTime', 'category', 'days', 'specialDate', 'notes', 'reminder', 'reminderType', 'reminderSound'];
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
function validateInput(body, event, isCreate) {
  const value = key => body[key] !== undefined ? body[key] : event?.[key];
  if (typeof value('title') !== 'string' || !value('title').trim()) return 'Event title is required';
  if (!timePattern.test(value('startTime') || '')) return 'Start time must be HH:mm';
  if (value('endTime') && !timePattern.test(value('endTime'))) return 'End time must be HH:mm';
  const days = value('days') || [];
  if (!Array.isArray(days) || days.some(d => !['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].includes(d)) || new Set(days).size !== days.length) return 'Invalid repeat days';
  const date = value('specialDate');
  if (body.specialDate != null) {
    if (typeof body.specialDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.specialDate)) return 'Date must be YYYY-MM-DD';
    const parsed = new Date(body.specialDate + 'T00:00:00.000Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== body.specialDate) return 'Invalid date';
  }
  if (date && days.length) return 'Choose a date or repeat days, not both';
  if ((isCreate || body.days !== undefined || body.specialDate !== undefined) && !date && !days.length) return 'Choose a date or at least one repeat day';
  if (body.reminder !== undefined && typeof body.reminder !== 'boolean') return 'Reminder must be a boolean';
  if (body.reminderType !== undefined && !['notification','alarm'].includes(body.reminderType)) return 'Invalid reminder type';
  if (body.reminderSound !== undefined && !['default','silent'].includes(body.reminderSound)) return 'Invalid reminder sound';
  return null;
}
function handleError(res, error) {
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) return res.status(400).json({ message: error.message });
  console.error('Schedule event error:', error);
  return res.status(500).json({ message: 'Server error' });
}

// Get all schedule events for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const events = await ScheduleEvent.find({ userId: req.userId }).sort({ startTime: 1 });
    res.json(events);
  } catch (error) {
    console.error('Error fetching schedule events:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new schedule event
router.post('/', auth, async (req, res) => {
  try {
    const error = validateInput(req.body, null, true);
    if (error) return res.status(400).json({ message: error });
    const data = Object.fromEntries(fields.filter(key => req.body[key] !== undefined).map(key => [key, req.body[key]]));
    const event = new ScheduleEvent({ ...data, userId: req.userId });

    const saved = await event.save();
    res.status(201).json(saved);
  } catch (error) {
    return handleError(res, error);
  }
});

// Update a schedule event
router.put('/:id', auth, async (req, res) => {
  try {
    const event = await ScheduleEvent.findOne({ _id: req.params.id, userId: req.userId });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const error = validateInput(req.body, event, false);
    if (error) return res.status(400).json({ message: error });
    for (const key of fields) if (req.body[key] !== undefined) event[key] = req.body[key];

    const updated = await event.save();
    res.json(updated);
  } catch (error) {
    return handleError(res, error);
  }
});

// Delete a schedule event
router.delete('/:id', auth, async (req, res) => {
  try {
    const event = await ScheduleEvent.findOneAndDelete({ _id: req.params.id, userId: req.userId });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
