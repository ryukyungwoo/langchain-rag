// server.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// 환경 변수 로드
dotenv.config();

// 서비스 가져오기
const ragService = require('./services/ragService');
const openaiService = require('./services/openaiService');
const s3Service = require('./services/s3Service');

// Express 앱 생성
const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// 임시 디렉터리 생성
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// 벡터 DB 디렉터리 생성
const vectorDbDir = process.env.VECTOR_DB_PATH;
if (!fs.existsSync(vectorDbDir)) {
  fs.mkdirSync(vectorDbDir, { recursive: true });
}

// 초기화 상태 관리
let isInitialized = false;

// 컨트롤러 함수들
// 챗봇 질문 처리
async function handleQuestion(req, res) {
  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: '유효한 질문을 입력해주세요.' });
    }

    // 벡터 저장소 초기화 확인
    if (!isInitialized) {
      console.log('벡터 저장소가 초기화되지 않았습니다. 초기화 중...');
      isInitialized = await ragService.initializeVectorStore();
    }

    // 관련 문서 검색
    const relevantDocuments = await ragService.retrieveRelevantDocuments(query);

    // 답변 생성
    const { answer, sources } = await openaiService.generateAnswer(query, relevantDocuments);

    // 응답 반환
    res.json({
      answer,
      sources,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('질문 처리 오류:', error);
    res.status(500).json({ error: `질문을 처리하는 중 오류가 발생했습니다: ${error.message}` });
  }
}

// 문서 목록 조회
async function listDocuments(req, res) {
  try {
    // 지원하는 확장자
    const supportedExtensions = ['.pdf', '.txt', '.md', '.docx', '.html'];

    // S3에서 문서 목록 가져오기
    const documents = await s3Service.listObjectsByExtension(supportedExtensions);

    res.json({
      count: documents.length,
      documents: documents.map(doc => ({
        name: doc.key,
        size: doc.size,
        lastModified: doc.lastModified
      }))
    });
  } catch (error) {
    console.error('문서 목록 조회 오류:', error);
    res.status(500).json({ error: `문서 목록을 조회하는 중 오류가 발생했습니다: ${error.message}` });
  }
}

// 문서 재색인화
async function reindexDocuments(req, res) {
  try {
    // 재색인화 실행
    const result = await ragService.reindexDocuments();

    // 초기화 상태 업데이트
    isInitialized = result.success;

    res.json({
      success: result.success,
      message: result.message
    });
  } catch (error) {
    console.error('문서 재색인화 오류:', error);
    res.status(500).json({ error: `문서를 재색인화하는 중 오류가 발생했습니다: ${error.message}` });
  }
}

// 시스템 상태 확인
async function checkStatus(req, res) {
  try {
    res.json({
      status: 'operational',
      initialized: isInitialized,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('상태 확인 오류:', error);
    res.status(500).json({ error: `상태를 확인하는 중 오류가 발생했습니다: ${error.message}` });
  }
}

// 라우트 설정
// 챗봇 질문 처리 - POST /api/chat
app.post('/api/chat', handleQuestion);

// 문서 목록 조회 - GET /api/documents
app.get('/api/documents', listDocuments);

// 문서 재색인화 - POST /api/reindex
app.post('/api/reindex', reindexDocuments);

// 시스템 상태 확인 - GET /api/status
app.get('/api/status', checkStatus);

// 기본 루트 라우트
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// 서버 시작
app.listen(PORT, async () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);

  try {
    // 서버 시작 시 벡터 저장소 초기화
    console.log('벡터 저장소 초기화 중...');
    await ragService.initializeVectorStore();
    isInitialized = true;
    console.log('벡터 저장소 초기화 완료');
  } catch (error) {
    console.error('벡터 저장소 초기화 오류:', error);
    console.log('서버는 계속 실행되지만, 벡터 저장소가 초기화되지 않았습니다.');
  }
});
