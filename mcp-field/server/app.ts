import { createRequestHandler } from '@react-router/express'
import express from 'express'

/** 页面请求交给 React Router 处理（服务端渲染、loader 数据请求、资源路由） */
export const app = express()

app.use(createRequestHandler({ build: () => import('virtual:react-router/server-build') }))
