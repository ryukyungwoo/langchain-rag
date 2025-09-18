
// services/s3Service.js
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// AWS SDK v3 S3 클라이언트 초기화
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const bucketName = process.env.S3_BUCKET_NAME;

// S3 버킷의 모든 객체 리스트 가져오기
async function listAllObjects() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName
    });

    const response = await s3Client.send(command);

    return response.Contents.map(item => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified
    }));
  } catch (error) {
    console.error('S3 객체 목록 조회 오류:', error);
    throw new Error(`S3 객체 목록을 조회하는 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 특정 확장자를 가진 파일만 필터링
async function listObjectsByExtension(extensions) {
  try {
    const allObjects = await listAllObjects();

    return allObjects.filter(obj => {
      const ext = path.extname(obj.key).toLowerCase();
      return extensions.includes(ext);
    });
  } catch (error) {
    console.error('S3 객체 필터링 오류:', error);
    throw error;
  }
}

// S3 객체 내용 가져오기
async function getObjectContent(key) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });

    const response = await s3Client.send(command);

// 스트림을 문자열로 변환
    return streamToString(response.Body);
  } catch (error) {
    console.error(`S3 객체 내용 가져오기 오류 (${key}):`, error);
    throw new Error(`S3 객체 내용을 가져오는 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 스트림을 문자열로 변환하는 유틸리티 함수
function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// 임시 파일로 S3 객체 다운로드
async function downloadObjectToTemp(key) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });

    const response = await s3Client.send(command);

// 임시 파일 경로 생성
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.join(tempDir, path.basename(key));

// 스트림을 파일로 저장
    const writeStream = fs.createWriteStream(tempFilePath);
    response.Body.pipe(writeStream);

    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => resolve(tempFilePath));
      writeStream.on('error', reject);
    });
  } catch (error) {
    console.error(`S3 객체 다운로드 오류 (${key}):`, error);
    throw new Error(`S3 객체를 다운로드하는 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 서명된 URL 생성
async function generateSignedUrl(key, expiresIn = 3600) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (error) {
    console.error(`서명된 URL 생성 오류 (${key}):`, error);
    throw new Error(`서명된 URL을 생성하는 중 오류가 발생했습니다: ${error.message}`);
  }
}

module.exports = {
  listAllObjects,
  listObjectsByExtension,
  getObjectContent,
  downloadObjectToTemp,
  generateSignedUrl
};
