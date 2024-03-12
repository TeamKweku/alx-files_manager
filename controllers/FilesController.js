/* eslint-disable import/no-named-as-default */
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';
import fs from 'fs';
import path from 'path';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';
import fileQueue from '../worker';

export default class FilesController {
  static async postUpload(req, res) {
    try {
      // Retrieve the user based on the token
      const token = req.header('X-Token');
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const userId = await redisClient.get(`auth_${token}`);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Validate request parameters
      const {
        name, type, isPublic, data,
      } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Missing name' });
      }
      if (!type || !['folder', 'file', 'image'].includes(type)) {
        return res.status(400).json({ error: 'Missing type or invalid type' });
      }
      if (!data && type !== 'folder') {
        return res.status(400).json({ error: 'Missing data' });
      }

      // Handle parentID
      let parentId = req.body.parentId || 0;
      if (parentId) {
        const parentFile = await dbClient
          .filesCollection()
          .findOne({ _id: ObjectId(parentId) });
        if (!parentFile) {
          return res.status(400).json({ error: 'Parent not found' });
        }

        if (parentFile.type !== 'folder') {
          return res.status(400).json({ error: 'Parent is not a folder' });
        }
      }
      parentId = parentId !== 0 ? ObjectId(parentId) : 0;

      // Save file metadata to database
      const fileDocument = {
        userId,
        name,
        type,
        isPublic: isPublic || false,
        parentId,
      };

      if (type === 'folder') {
        const newFolder = await dbClient.collection('files').insertOne({
          userId,
          name,
          type,
          isPublic: isPublic || false,
          parentId,
        });
        fileDocument.parentId = parentId === '0' ? 0 : ObjectId(parentId);
        return res
          .status(201)
          .json({ id: newFolder.insertedId, ...fileDocument });
      }

      // Return response
      const folderName = process.env.FOLDER_PATH || '/tmp/files_manager';
      const fileId = uuidv4();
      const localPath = path.join(folderName, fileId);
      await fs.promises.mkdir(folderName, { recursive: true });
      await fs.promises.writeFile(
        path.join(folderName, fileId),
        Buffer.from(data, 'base64'),
      );

      const newFile = await dbClient
        .filesCollection()
        .insertOne({ localPath, ...fileDocument });

      if (type === 'image') {
        fileQueue.add({ fileId: newFile.insertedId, userId });
      }

      fileDocument.parentId = parentId === '0' ? 0 : ObjectId(parentId);

      const responseObject = { id: newFile.insertedId, ...fileDocument };
      delete responseObject.localPath;

      return res.status(201).json(responseObject);
    } catch (error) {
      console.error('Error uploading file:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  static async getShow(req, res) {
    const token = req.header('X-Token');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;
    const file = await dbClient
      .filesCollection('files')
      .findOne({ _id: ObjectId(fileId), userId });

    if (!file) return res.status(404).json({ error: 'Not found' });

    return res.json(file);
  }

  static async getIndex(req, res) {
    const token = req.header('X-Token');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const parentId = req.query.parentId || '0';

    const filesCount = await dbClient
      .filesCollection('files')
      .countDocuments({ userId, parentId });

    if (filesCount === 0) return res.json([]);

    const skip = (parseInt(req.query.page, 10) || 0) * 20;
    const files = await dbClient
      .filesCollection('files')
      .aggregate([
        { $match: { userId, parentId } },
        { $skip: skip },
        { $limit: 20 },
      ])
      .toArray();

    const modifyResult = files.map((file) => ({
      ...file,
      id: file._id,
      _id: undefined,
    }));

    return res.json(modifyResult);
  }

  static async putPublish(req, res) {
    const token = req.header('X-Token');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;
    const file = await dbClient
      .filesCollection('files')
      .findOne({ _id: ObjectId(fileId), userId: ObjectId(userId) });
    if (!file) return res.status(404).json({ error: 'Not found' });

    await dbClient
      .filesCollection('files')
      .updateOne({ _id: ObjectId(fileId) }, { $set: { isPublic: true } });

    const updatedFile = await dbClient
      .filesCollection('files')
      .findOne({ _id: ObjectId(fileId) });
    return res.status(200).json(updatedFile);
  }

  static async putUnpublish(req, res) {
    const token = req.header('X-Token');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;
    const file = await dbClient
      .filesCollection('files')
      .findOne({ _id: ObjectId(fileId), userId: ObjectId(userId) });
    if (!file) return res.status(404).json({ error: 'Not found' });

    await dbClient
      .filesCollection('files')
      .updateOne({ _id: ObjectId(fileId) }, { $set: { isPublic: false } });

    const updatedFile = await dbClient
      .filesCollection('files')
      .findOne({ _id: ObjectId(fileId) });
    return res.status(200).json(updatedFile);
  }

  static async getFile(req, res) {
    const token = req.header('X-Token');
    const userId = await redisClient.get(`auth_${token}`);
    const fileId = req.params.id;
    const { size } = req.query;
    const file = await dbClient
      .filesCollection('files')
      .findOne({ _id: ObjectId(fileId) });
    if (
      !file
      || (!file.isPublic && (!userId || userId !== file.userId.toString()))
    ) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (file.type === 'folder') return res.status(400).json({ error: "A folder doesn't have content" });

    let { localPath } = file;
    if (size) localPath = `${localPath}_${size}`;

    if (!fs.existsSync(localPath)) return res.status(404).json({ error: 'Not found' });

    res.setHeader('Content-Type', mime.lookup(file.name));
    return res.sendFile(localPath);
  }
}
