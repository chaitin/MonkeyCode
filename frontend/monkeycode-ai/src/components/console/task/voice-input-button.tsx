import { useState, useEffect, useRef } from "react"
import { InputGroupButton } from "@/components/ui/input-group"
import { IconMicrophone } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "sonner"
import type { DomainSpeechRecognitionEvent } from "@/api/Api"
import React from "react"
import { cn } from "@/lib/utils"

interface VoiceInputButtonProps {
  disabled?: boolean
  onTextRecognized: (text: string) => void
  className?: string
}

export const VoiceInputButton = ({ disabled = false, className = '', onTextRecognized }: VoiceInputButtonProps) => {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioDataRef = useRef<Int16Array[]>([])
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)

  // 加载 AudioWorklet
  const loadAudioWorklet = async (audioContext: AudioContext): Promise<void> => {
    // 创建内联 AudioWorkletProcessor
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs, outputs) {
          const input = inputs[0]
          if (input && input.length > 0) {
            const inputData = input[0]
            // 转换为 16 位 PCM
            const pcmData = new Int16Array(inputData.length)
            for (let i = 0; i < inputData.length; i++) {
              pcmData[i] = Math.max(-32768, Math.min(32767, Math.ceil(inputData[i] * 32768)))
            }
            // 发送 PCM 数据到主线程
            this.port.postMessage({ pcmData: pcmData.buffer }, [pcmData.buffer])
          }
          return true
        }
      }
      
      registerProcessor('pcm-processor', PCMProcessor)
    `

    const blob = new Blob([workletCode], { type: 'application/javascript' })
    const workletUrl = URL.createObjectURL(blob)

    try {
      await audioContext.audioWorklet.addModule(workletUrl)
    } finally {
      URL.revokeObjectURL(workletUrl)
    }
  }

  // 开始录制音频
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      
      // 创建 AudioContext，使用 16000Hz 采样率
      const audioContext = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioContext
      
      // 加载 AudioWorklet
      await loadAudioWorklet(audioContext)
      
      // 创建音频源节点
      const sourceNode = audioContext.createMediaStreamSource(stream)
      sourceNodeRef.current = sourceNode
      
      // 创建 AudioWorkletNode
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor')
      workletNodeRef.current = workletNode
      
      audioDataRef.current = []
      
      // 接收来自 worklet 的 PCM 数据
      workletNode.port.onmessage = (event) => {
        const { pcmData } = event.data
        if (pcmData) {
          audioDataRef.current.push(new Int16Array(pcmData))
        }
      }
      
      // 连接节点
      sourceNode.connect(workletNode)
      workletNode.connect(audioContext.destination)
      
      setIsRecording(true)
    } catch (error) {
      console.error('无法访问麦克风:', error)
      toast.error('无法访问麦克风，请检查权限设置')
    }
  }

  // 停止录制
  const stopRecording = async () => {
    if (!isRecording || !audioContextRef.current || !workletNodeRef.current) {
      return
    }
    
    setIsRecording(false)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // 断开节点连接
    if (workletNodeRef.current) {
      workletNodeRef.current.port.close()
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect()
      sourceNodeRef.current = null
    }
    
    // 等待一小段时间确保所有音频数据都被处理
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // 合并所有 PCM 数据
    const totalLength = audioDataRef.current.reduce((sum, chunk) => sum + chunk.length, 0)
    
    if (totalLength > 0) {
      // 将所有数据块合并
      const allData = new Int16Array(totalLength)
      let offset = 0
      for (const chunk of audioDataRef.current) {
        allData.set(chunk, offset)
        offset += chunk.length
      }
      
      // 将 PCM 数据转换为 Blob
      const pcmBlob = new Blob([allData.buffer], { type: 'audio/pcm' })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = `recording-${timestamp}.pcm`
      
      // 调用语音转文字API
      setIsProcessing(true)
      try {
        const formData = new FormData()
        const audioFile = new File([pcmBlob], fileName, { type: 'audio/pcm' })
        formData.append('audio', audioFile)
        
        const response = await fetch('/api/v1/users/tasks/speech-to-text', {
          method: 'POST',
          credentials: 'same-origin',
          body: formData,
        })
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        
        // 处理SSE流
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = ''
        
        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''
            
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim()
              } else if (line.startsWith('data: ')) {
                try {
                  const eventData = JSON.parse(line.slice(6))
                  const event: DomainSpeechRecognitionEvent = {
                    event: currentEvent,
                    data: eventData
                  }
                  
                  if (event.event === 'recognition' && event.data?.type === 'result' && event.data.text) {
                    onTextRecognized(event.data.text)
                  } else if (event.event === 'end' || event.data?.type === 'end') {
                    // 识别完成
                    break
                  } else if (event.event === 'error' || (event.data?.type === 'error' && event.data?.error)) {
                    throw new Error(event.data?.error || '语音识别出错')
                  }
                } catch (e) {
                  console.error('解析SSE数据失败:', e)
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('语音识别失败:', error)
        toast.error(`语音识别失败: ${error instanceof Error ? error.message : '未知错误'}`)
      } finally {
        setIsProcessing(false)
      }
      
      // 清空音频数据
      audioDataRef.current = []
    }
    
    // 关闭 AudioContext
    if (audioContextRef.current) {
      await audioContextRef.current.close()
      audioContextRef.current = null
    }
    
    // 停止所有音频轨道
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }

  // 处理指针按下（开始录制）
  const handlePointerDown = (e: React.PointerEvent) => {
    // 只处理主按钮（鼠标左键或触摸）
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return
    }
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!isRecording) {
      startRecording()
    }
  }

  // 处理指针松开（停止录制）
  const handlePointerUp = (e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (isRecording) {
      stopRecording()
    }
  }

  // 处理指针取消（用户拖拽离开按钮）
  const handlePointerCancel = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (isRecording) {
      stopRecording()
    }
  }

  // 清理资源
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (workletNodeRef.current) {
        workletNodeRef.current.port.close()
        workletNodeRef.current.disconnect()
        workletNodeRef.current = null
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect()
        sourceNodeRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error)
        audioContextRef.current = null
      }
    }
  }, [])

  return (
    <InputGroupButton 
      variant={isRecording ? "default" : "outline"} 
      size={isRecording ? "sm" : "icon-sm"} 
      className={cn("cursor-pointer rounded-full", className)}
      disabled={disabled || isProcessing}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {isProcessing ? (
        <Spinner className="size-4" />
      ) : (
        isRecording ? (
          <>
            <IconMicrophone className="" />
            正在录音
          </>
        ) : (
          <IconMicrophone />
        )
      )}
    </InputGroupButton>
  )
}

