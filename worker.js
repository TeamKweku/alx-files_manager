/* eslint-disable import/no-named-as-default */
import Queue from 'bull';
import imageThumb from 'image-thumbnail';
import { ObjectId } from 'mongodb';
import fs from 'fs';
import dbClient from './utils/db';

const fileQueue = new Queue('fileQueue');

fileQueue.process(async (job) => {
  try {
    const { fileId, userId } = job.data;
    if (!fileId) throw new Error('Missing fileId');
    if (!userId) throw new Error('Missing userId');

    const file = await dbClient
      .filesCollection('files')
      .findOne({ _id: ObjectId(fileId), userId: ObjectId(userId) });
    if (!file) throw new Error('File not found');
    const path = file.localPath;
    fs.writeFileSync(`${path}_500`, await imageThumb(path, { width: 500 }));

    fs.writeFileSync(`${path}_250`, await imageThumb(path, { width: 250 }));

    fs.writeFileSync(`${path}_100`, await imageThumb(path, { width: 100 }));
  } catch (error) {
    console.error('An error occurred:', error);
  }
});

export default fileQueue;
