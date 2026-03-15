const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ScheduleEvent = require('../models/ScheduleEvent');

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
    const { title, startTime, endTime, category, days, specialDate, notes, reminder } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Event title is required' });
    }
    if (!startTime) {
      return res.status(400).json({ message: 'Start time is required' });
    }

    const event = new ScheduleEvent({
      title: title.trim(),
      startTime,
      endTime: endTime || '',
      category: category || 'personal',
      days: days || [],
      specialDate: specialDate || null,
      notes: notes || '',
      reminder: reminder || false,
      userId: req.userId,
    });

    const saved = await event.save();
    res.status(201).json(saved);
  } catch (error) {
    console.error('Error creating schedule event:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update a schedule event
router.put('/:id', auth, async (req, res) => {
  try {
    const event = await ScheduleEvent.findOne({ _id: req.params.id, userId: req.userId });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const { title, startTime, endTime, category, days, specialDate, notes, reminder } = req.body;

    if (title !== undefined) event.title = title.trim();
    if (startTime !== undefined) event.startTime = startTime;
    if (endTime !== undefined) event.endTime = endTime;
    if (category !== undefined) event.category = category;
    if (days !== undefined) event.days = days;
    if (specialDate !== undefined) event.specialDate = specialDate;
    if (notes !== undefined) event.notes = notes;
    if (reminder !== undefined) event.reminder = reminder;

    const updated = await event.save();
    res.json(updated);
  } catch (error) {
    console.error('Error updating schedule event:', error);
    res.status(500).json({ message: 'Server error' });
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
    console.error('Error deleting schedule event:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
