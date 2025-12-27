import dotenv from 'dotenv'
dotenv.config()
import express, { Express } from 'express';

const server = async (app: Express) => {
   app.use('/static', express.static('public'));
   app.use(express.json());
   app.use(express.urlencoded({ extended: true }));
   app.disable('etag');

}
export default server;