const { ChatOpenAI } = require("@langchain/openai");
const dotenv = require('dotenv');

dotenv.config();

// OpenAI 클라이언트 초기화
const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.7,
});

// 시스템 프롬프트 생성
function createSystemPrompt() {
  return `당신은 기업 내부 문서 기반 지식을 활용하여 질문에 답변하는 AI 어시스턴트입니다.
다음 가이드라인을 따라주세요:

1. 제공된 문서의 정보를 기반으로 정확하게 답변하세요.
2. 문서에서 찾을 수 없는 정보에 대해서는 모른다고 솔직하게 말하세요.
3. 답변 시 참조한 문서의 출처를 함께 제공하세요.
4. 전문 용어나 복잡한 개념이 있다면 쉽게 설명해주세요.
5. 공손하고 전문적인 어조를 유지하세요.`;
}

// 관련 문서에 기반한 답변 생성
async function generateAnswer(query, relevantDocuments) {
  try {
    // 관련 문서가 없는 경우
    if (!relevantDocuments || relevantDocuments.length === 0) {
      return {
        answer: "죄송합니다. 질문과 관련된 정보를 찾을 수 없습니다. 다른 질문이나 키워드로 시도해 주세요.",
        sources: []
      };
    }

    // 문서 내용 추출 및 포맷팅
    const contexts = relevantDocuments.map((doc, i) => {
      // 메타데이터에서 소스 정보 추출
      const source = doc.metadata.source || `문서 ${i + 1}`;
      return `문서 [${i + 1}] (출처: ${source}):\n${doc.pageContent}\n`;
    });

    // 프롬프트 구성
    const prompt = `
${createSystemPrompt()}

다음은 당신이 질문에 답하기 위해 참조할 수 있는 관련 문서입니다:
${contexts.join('\n')}

사용자 질문: ${query}

답변 형식:
1. 질문에 직접적으로 답변해주세요.
2. 답변 후 참조한 문서 번호를 [문서 1, 문서 3]과 같은 형식으로 제시해주세요.
`;

    // OpenAI API 호출 - model.invoke() 사용
    const response = await model.invoke(prompt);

    // LangChain ChatOpenAI의 응답은 객체 형태이므로 content 추출
    const answerText = response.content || response;

    // 응답에서 참조 문서 추출
    const sourcesPattern = /\[문서\s+(\d+(?:,\s*\d+)*)\]/i;
    const sourcesMatch = answerText.match(sourcesPattern);

    let sourceIndices = [];
    if (sourcesMatch && sourcesMatch[1]) {
      // 숫자 추출
      sourceIndices = sourcesMatch[1].split(/,\s*/).map(num => parseInt(num.trim()) - 1);
    }

    // 소스 정보 구성
    const sources = sourceIndices
      .filter(index => index >= 0 && index < relevantDocuments.length)
      .map(index => ({
        title: relevantDocuments[index].metadata.source || `문서 ${index + 1}`,
        content: relevantDocuments[index].pageContent.substring(0, 150) + '...'
      }));

    return {
      answer: answerText,
      sources: sources
    };
  } catch (error) {
    console.error('답변 생성 오류:', error);
    throw new Error(`답변을 생성하는 중 오류가 발생했습니다: ${error.message}`);
  }
}

module.exports = {
  generateAnswer
};