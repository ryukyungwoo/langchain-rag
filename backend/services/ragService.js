// services/ragService.js
const { Document } = require('langchain/document');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { OpenAIEmbeddings } = require('@langchain/openai');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { TextLoader } = require('langchain/document_loaders/fs/text');
const { DocxLoader } = require('@langchain/community/document_loaders/fs/docx');
const { DirectoryLoader } = require('langchain/document_loaders/fs/directory');
const { S3Loader } = require('@langchain/community/document_loaders/web/s3');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const path = require('path');
const fs = require('fs');
const s3Service = require('./s3Service');
const dotenv = require('dotenv');

dotenv.config();

// OpenAI 임베딩 초기화
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: process.env.OPENAI_API_KEY
});

// 벡터 저장소 경로
const vectorDBPath = process.env.VECTOR_DB_PATH || './faiss_store';

// 지원하는 파일 확장자
const SUPPORTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.docx', '.html'];

// 벡터 저장소 인스턴스
let vectorStore;

// 문서 청크로 분할
async function splitDocumentsIntoChunks(documents) {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 200
  });

  return await textSplitter.splitDocuments(documents);
}

// S3 버킷에서 문서 로드
async function loadDocumentsFromS3() {
  try {
    console.log('S3 버킷에서 문서 로드 중...');

    // 지원하는 확장자를 가진 객체 목록 가져오기
    const objects = await s3Service.listObjectsByExtension(SUPPORTED_EXTENSIONS);

    if (objects.length === 0) {
      console.log('처리할 문서가 없습니다.');
      return [];
    }

    console.log(`${objects.length}개의 문서를 찾았습니다.`);

    const documents = [];

    // 각 파일 처리
    for (const obj of objects) {
      try {
        const ext = path.extname(obj.key).toLowerCase();
        let content;
        let tempFilePath;

        // 파일 형식에 따라 다른 처리 방법 적용
        if (ext === '.pdf') {
          // PDF 파일은 임시 파일로 다운로드하여 처리
          tempFilePath = await s3Service.downloadObjectToTemp(obj.key);
          const pdfLoader = new PDFLoader(tempFilePath);
          const pdfDocs = await pdfLoader.load();
          documents.push(...pdfDocs);
        }
        else if (ext === '.docx') {
          // DOCX 파일은 임시 파일로 다운로드하여 처리
          tempFilePath = await s3Service.downloadObjectToTemp(obj.key);
          const docxLoader = new DocxLoader(tempFilePath);
          const docxDocs = await docxLoader.load();
          documents.push(...docxDocs);
        }
        else {
          // 텍스트 기반 파일은 직접 내용 가져오기
          content = await s3Service.getObjectContent(obj.key);
          documents.push(
            new Document({
              pageContent: content,
              metadata: {
                source: obj.key,
                lastModified: obj.lastModified
              }
            })
          );
        }

        // 임시 파일 정리
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }

        console.log(`문서 처리 완료: ${obj.key}`);
      } catch (error) {
        console.error(`문서 처리 중 오류 (${obj.key}):`, error);
        // 오류가 발생해도 계속 진행
        continue;
      }
    }

    console.log(`총 ${documents.length}개의 문서를 로드했습니다.`);
    return documents;
  } catch (error) {
    console.error('S3에서 문서 로드 오류:', error);
    throw new Error(`S3에서 문서를 로드하는 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 벡터 저장소 초기화 및 문서 색인화
async function initializeVectorStore() {
  try {
    console.log('벡터 저장소 초기화 중...');

    // 기존 FAISS 저장소가 있는지 확인하고 로드 시도
    if (fs.existsSync(vectorDBPath)) {
      try {
        console.log('기존 FAISS 저장소를 로드 중...');
        vectorStore = await FaissStore.load(vectorDBPath, embeddings);
        console.log('기존 벡터 저장소를 성공적으로 로드했습니다.');
        return true;
      } catch (error) {
        console.log('기존 저장소 로드 실패, 새로 생성합니다:', error.message);
      }
    }

    // 문서 로드
    const documents = await loadDocumentsFromS3();

    if (documents.length === 0) {
      console.log('색인화할 문서가 없습니다.');
      // 빈 벡터 저장소 초기화
      vectorStore = await MemoryVectorStore.fromDocuments(
        [new Document({ pageContent: "No documents available" })],
        embeddings
      );
      return false;
    }

    // 문서를 청크로 분할
    const chunks = await splitDocumentsIntoChunks(documents);
    console.log(`문서를 ${chunks.length}개의 청크로 분할했습니다.`);

    // FAISS 벡터 저장소 생성
    vectorStore = await FaissStore.fromDocuments(chunks, embeddings);

    // 벡터 저장소를 디스크에 저장
    await vectorStore.save(vectorDBPath);

    console.log('벡터 저장소 초기화 완료');
    return true;
  } catch (error) {
    console.error('벡터 저장소 초기화 오류:', error);
    throw new Error(`벡터 저장소를 초기화하는 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 관련 문서 검색
async function retrieveRelevantDocuments(query, topK = 5) {
  try {
    if (!vectorStore) {
      console.log('벡터 저장소가 초기화되지 않았습니다. 초기화 중...');
      await initializeVectorStore();
    }

    const results = await vectorStore.similaritySearch(query, topK);

    // 검색 결과 로깅
    console.log(`"${query}"에 대해 ${results.length}개의 관련 문서를 찾았습니다.`);

    return results;
  } catch (error) {
    console.error('문서 검색 오류:', error);
    throw new Error(`관련 문서를 검색하는 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 문서 재색인화
async function reindexDocuments() {
  try {
    console.log('문서 재색인화 시작...');

    // 기존 벡터 저장소 정리
    if (fs.existsSync(vectorDBPath)) {
      console.log('기존 벡터 저장소 정리 중...');
      fs.rmSync(vectorDBPath, { recursive: true, force: true });
    }

    // 벡터 저장소를 null로 설정하여 재초기화 강제
    vectorStore = null;

    // 벡터 저장소 다시 초기화
    const result = await initializeVectorStore();

    return {
      success: result,
      message: result ? '문서 재색인화가 완료되었습니다.' : '색인화할 문서가 없습니다.'
    };
  } catch (error) {
    console.error('문서 재색인화 오류:', error);
    throw new Error(`문서를 재색인화하는 중 오류가 발생했습니다: ${error.message}`);
  }
}

module.exports = {
  initializeVectorStore,
  retrieveRelevantDocuments,
  reindexDocuments
};