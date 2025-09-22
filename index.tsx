

// Removed GoogleGenAI import as it's now handled by the backend.
import { Document, Packer, Paragraph, TextRun, AlignmentType, ImageRun } from "docx";
import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker for pdfjs-dist with a full URL to avoid "fake worker" warnings.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.worker.mjs';


const adaptButton = document.getElementById('adapt-btn') as HTMLButtonElement;
const loadingIndicator = document.getElementById('loading') as HTMLDivElement;
const pdfUpload = document.getElementById('pdf-upload') as HTMLInputElement;
const fileNameDisplay = document.getElementById('file-name-display') as HTMLParagraphElement;

const luziaOutput = document.getElementById('luzia-output') as HTMLPreElement;
const brendaOutput = document.getElementById('brenda-output') as HTMLPreElement;
const luziaDownloadBtn = document.getElementById('luzia-download-btn') as HTMLButtonElement;
const brendaDownloadBtn = document.getElementById('brenda-download-btn') as HTMLButtonElement;

let luziaAdaptedText = '';
let brendaAdaptedText = '';
let selectedFileBase64: { mimeType: string; data: string; } | null = null;
let selectedFileObject: File | null = null;
let originalFileName = '';


pdfUpload.addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
        fileNameDisplay.textContent = 'Nenhum arquivo selecionado';
        selectedFileBase64 = null;
        selectedFileObject = null;
        originalFileName = '';
        return;
    }
    if (file.type !== 'application/pdf') {
        alert('Por favor, selecione um arquivo PDF.');
        pdfUpload.value = ''; // Reset input
        fileNameDisplay.textContent = 'Nenhum arquivo selecionado';
        selectedFileBase64 = null;
        selectedFileObject = null;
        originalFileName = '';
        return;
    }

    fileNameDisplay.textContent = `Arquivo selecionado: ${file.name}`;
    originalFileName = file.name;
    selectedFileObject = file;
    
    // Read file and convert to base64 for the API request
    const reader = new FileReader();
    reader.onloadend = () => {
        const dataUrl = reader.result as string;
        // remove the "data:application/pdf;base64," part
        const base64Data = dataUrl.substring(dataUrl.indexOf(',') + 1);
        selectedFileBase64 = {
            mimeType: 'application/pdf',
            data: base64Data
        };
    };
    reader.readAsDataURL(file);
});


// Prompt functions have been moved to the backend serverless function.


async function handleAdaptation() {
    if (!selectedFileBase64 || !selectedFileObject) {
        alert('Por favor, selecione um arquivo PDF para adaptar.');
        return;
    }

    setLoading(true);
    // Clear previous results for better user experience
    luziaOutput.textContent = '';
    brendaOutput.textContent = '';
    luziaAdaptedText = '';
    brendaAdaptedText = '';


    try {
        // Call the new backend endpoint instead of Gemini API directly
        const response = await fetch('/api/adapt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pdfData: selectedFileBase64 }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        luziaAdaptedText = data.luziaAdaptedText;
        brendaAdaptedText = data.brendaAdaptedText;

        luziaOutput.textContent = luziaAdaptedText;
        brendaOutput.textContent = brendaAdaptedText;
        
        luziaDownloadBtn.disabled = false;
        brendaDownloadBtn.disabled = false;

    } catch (error) {
        console.error("Erro durante a adaptação:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        alert(`Ocorreu um erro ao adaptar o documento: ${errorMessage}`);
        // Display error in the UI for better feedback
        luziaOutput.textContent = `Erro: ${errorMessage}`;
        brendaOutput.textContent = `Erro: ${errorMessage}`;
    } finally {
        setLoading(false);
    }
}

async function generateAndDownloadDocx(text: string, person: 'luzia' | 'brenda') {
    if (!text || !originalFileName) return;

    const paragraphs: Paragraph[] = [];
    
    if (person === 'luzia') {
        const rawParagraphs = text.split('\n').filter(p => p.trim() !== '');
        rawParagraphs.forEach(p => {
            const isBold = p.startsWith('**') && p.endsWith('**');
            const cleanText = p.replace(/\*\*/g, '');
            const isPageNumber = isBold && cleanText.toLowerCase().startsWith('página');
            const isTitle = isBold && !isPageNumber;

            if (isPageNumber) {
                paragraphs.push(new Paragraph({
                    children: [new TextRun({ text: cleanText, font: 'Arial', size: 24, bold: true })], // 12pt
                    alignment: AlignmentType.JUSTIFIED,
                }));
            } else if (isTitle) {
                paragraphs.push(new Paragraph({
                    children: [new TextRun({ text: cleanText, font: 'Arial', size: 28, bold: true })], // 14pt
                    alignment: AlignmentType.JUSTIFIED,
                }));
            } else {
                paragraphs.push(new Paragraph({
                    children: [new TextRun({ text: cleanText, font: 'Arial', size: 24 })], // 12pt
                    indent: { firstLine: 709 }, // ~1.25cm
                    alignment: AlignmentType.JUSTIFIED,
                    spacing: { line: 240 } // Single line spacing
                }));
            }
        });
    } else { // Brenda - With images
        if (!selectedFileObject) return;

        const arrayBuffer = await selectedFileObject.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

        const placeholderRegex = /\[IMAGEM_PAGINA_(\d+)\]/g;
        const parts = text.split(placeholderRegex);

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            if (i % 2 === 0) { // Text part
                const rawParagraphs = part.split('\n').filter(p => p.trim() !== '');
                rawParagraphs.forEach(p => {
                    const isBold = p.startsWith('**') && p.endsWith('**');
                    const cleanText = p.replace(/\*\*/g, '');

                    paragraphs.push(new Paragraph({
                        children: [
                            new TextRun({ text: cleanText, font: 'Arial', size: 40, bold: isBold }) // 20pt
                        ],
                        alignment: AlignmentType.JUSTIFIED,
                        spacing: { line: 360 } // 1.5 line spacing
                    }));
                });
            } else { // Page number for image part
                const pageNum = parseInt(part, 10);
                if (!isNaN(pageNum) && pageNum > 0 && pageNum <= pdf.numPages) {
                     try {
                        const page = await pdf.getPage(pageNum);
                        
                        // Primary method: Render the whole page to a canvas. This is more robust
                        // than trying to extract raw image data.
                        const viewport = page.getViewport({ scale: 1.5 });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        if (!context) throw new Error("Canvas context not available for page rendering.");
                        
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        
                        await page.render({ canvasContext: context, viewport: viewport }).promise;

                        const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
                        const base64String = dataUrl.split(",")[1];
                        const binaryString = atob(base64String);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let k = 0; k < binaryString.length; k++) {
                            bytes[k] = binaryString.charCodeAt(k);
                        }

                        const imageWidth = 500;
                        const imageHeight = (canvas.height / canvas.width) * imageWidth;
                        paragraphs.push(new Paragraph({
                            children: [
                                new ImageRun({
                                    data: bytes,
                                    transformation: { width: imageWidth, height: imageHeight },
                                }),
                            ],
                            alignment: AlignmentType.CENTER,
                            spacing: { after: 200 },
                        }));

                    } catch (pageError) {
                        console.error(`Error processing page ${pageNum} for image extraction:`, pageError);
                        // If rendering fails, add an error message to the document so the user knows.
                        paragraphs.push(new Paragraph({
                            children: [new TextRun({ text: `[Erro ao extrair imagem da página ${pageNum}]`, italics: true, font: 'Arial', size: 24 })]
                        }));
                    }
                }
            }
        }
    }

    const doc = new Document({
        sections: [{
            properties: {},
            children: paragraphs,
        }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const baseName = originalFileName.substring(0, originalFileName.lastIndexOf('.')) || originalFileName;
    const versionType = person === 'luzia' ? 'braille' : 'alta-legibilidade';
    a.download = `${baseName}-${versionType}-adaptado.docx`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function setLoading(isLoading: boolean) {
    if (isLoading) {
        adaptButton.disabled = true;
        loadingIndicator.style.display = 'flex';
        luziaDownloadBtn.disabled = true;
        brendaDownloadBtn.disabled = true;
    } else {
        adaptButton.disabled = false;
        loadingIndicator.style.display = 'none';
    }
}


adaptButton.addEventListener('click', handleAdaptation);
luziaDownloadBtn.addEventListener('click', () => generateAndDownloadDocx(luziaAdaptedText, 'luzia'));
brendaDownloadBtn.addEventListener('click', () => generateAndDownloadDocx(brendaAdaptedText, 'brenda'));