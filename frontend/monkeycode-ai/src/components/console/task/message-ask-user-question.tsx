import { useState, useCallback, useMemo, Fragment, useEffect } from "react"
import type { MessageType } from "./message"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const AskUserQuestionMessageItem = ({ message, onResponse }: { message: MessageType; onResponse?: (askId: string, answers: any) => void }) => {
  // 使用 Map 存储每个问题的选中项，key 是问题索引，value 是选中的 option label 集合
  const [selections, setSelections] = useState<Set<string>[]>(() => 
    Array.from({ length: message.data.questions?.length || 0 }, () => new Set<string>())
  )
  const [disabled, setDisabled] = useState(false)
  const [userCustomAnswers, setUserCustomAnswers] = useState<string[]>(Array(message.data.questions?.length || 0).fill(''))

  useEffect(() => {
    const newSelections = (message.data.questions || []).map((question) => {
      if (Array.isArray(question.answer)) {
        return new Set(question.answer)
      } else if (typeof question.answer === "string") {
        return new Set([question.answer])
      } else {
        return new Set<string>()
      }
    })
    
    setSelections(newSelections)
  }, [message.data.questions])

  const handleCheckboxClick = (questionIndex: number, optionLabel: string, checked: boolean) => {
    setSelections(prev => {
      const newSelections = [...prev]
      if (checked) {
        newSelections[questionIndex].add(optionLabel)
      } else {
        newSelections[questionIndex].delete(optionLabel)
      }

      return newSelections
    })
  }

  const handleRadioClick = (questionIndex: number, optionLabel: string) => {
    setSelections(prev => {
      const newSelections = [...prev]
      newSelections[questionIndex].clear()
      newSelections[questionIndex].add(optionLabel)
      return newSelections
    })
  }

  const hasUserCustomAnswer = useCallback((questionIndex: number) => {
    const question = message.data.questions?.[questionIndex]
    const options = question?.options.map(option => option.label) || []
    if (question?.multiSelect) {
      return ((question?.answer || []) as string[]).some(answer => !options.includes(answer))
    } else {
      return question?.answer && !options.includes(question?.answer)
    }
  }, [message.data.questions])

  const userCustomAnswer = useCallback((questionIndex: number) => {
    const question = message.data.questions?.[questionIndex]
    const options = question?.options.map(option => option.label) || []

    return ((question?.answer || []) as string[]).find((answer: string) => !options.includes(answer)) || ''

  }, [message.data.questions])

  const isCheckboxChecked = useCallback((questionIndex: number, optionLabel: string) => {
    return selections[questionIndex].has(optionLabel)
  }, [selections])

  const isAllQuestionsAnswered = useMemo(() => {
    const questions = message.data.questions || []
    if (questions.length === 0) return false
    
    return questions.every((_, questionIndex) => {
      const selectedSet = selections[questionIndex]

      if (selectedSet.size === 0) return false

      if (selectedSet.has('user-custom') && userCustomAnswers[questionIndex] === '') {
        return false
      }
      return true
    })
  }, [selections, message.data.questions, userCustomAnswers])

  const sumbit = () => {
    setDisabled(true)
    const answers: Record<string, string | string[]> = {}
    message.data.questions?.forEach((question, questionIndex) => {
      const selectedSet = selections[questionIndex]
      if (selectedSet && selectedSet.size > 0) {
        const answerSet = new Set(selectedSet)

        if (answerSet.has('user-custom')) {
          answerSet.delete('user-custom')
          answerSet.add(userCustomAnswers[questionIndex])
        }

        answers[question.question] = question.multiSelect ? Array.from(answerSet) : answerSet.values().next().value || ''
      }
    })
    onResponse?.(message.data.askId || '', answers)
  }

  return (
    <div className="w-max-[80%] w-[80%] border rounded-md p-2" onClick={() => {
      console.log(message.data.questions)
    }}>
      {message.data.questions?.map((question, questionIndex) => (
        <Fragment key={questionIndex}>
          <div className="flex flex-col p-2 gap-4">
            <div className="text-sm font-bold">
              {question.question}
            </div>
            {question.multiSelect ? (
              <FieldGroup 
                className="max-w-sm flex flex-wrap gap-2">
                {question.options.map((option, index) => {
                  return (
                    <Field orientation="horizontal" key={index} >
                      <Checkbox 
                        id={`${message.data.askId}-${questionIndex}-${option.label}`}
                        name={`${message.data.askId}-${questionIndex}-${option.label}`}
                        disabled={message.data.status !== 'pending' || disabled}
                        checked={isCheckboxChecked(questionIndex, option.label)}
                        onCheckedChange={(checked) => {
                          handleCheckboxClick(questionIndex, option.label, checked)
                        }}
                      />
                      <Label 
                        htmlFor={`${message.data.askId}-${questionIndex}-${option.label}`} 
                        className={cn("font-normal truncate", (message.data.status !== 'pending' && !isCheckboxChecked(questionIndex, option.label)) ? 'text-muted-foreground/50' : '')}>{option.label}</Label>
                    </Field>
                  )
                })}
                {message.data.status === 'pending' ? (
                  <>
                    <Field orientation="horizontal">
                      <Checkbox 
                        id={`${message.data.askId}-${questionIndex}-user-custom`}
                        name={`${message.data.askId}-${questionIndex}-user-custom`}
                        disabled={message.data.status !== 'pending' || disabled}
                        checked={isCheckboxChecked(questionIndex, 'user-custom')}
                        onCheckedChange={(checked) => {
                          handleCheckboxClick(questionIndex, 'user-custom', checked)
                        }}
                      >
                      </Checkbox>
                      <Label htmlFor={`${message.data.askId}-${questionIndex}-user-custom`} className="font-normal" >其他 - 自定义</Label>
                    </Field>
                    {selections[questionIndex].has('user-custom') && <Field orientation="horizontal" >
                      <Input
                        value={userCustomAnswers[questionIndex]}
                        disabled={disabled}
                        placeholder="请输入其他答案"
                        onChange={(e) => {
                          setUserCustomAnswers(prev => {
                            const newUserCustomAnswers = [...prev]
                            newUserCustomAnswers[questionIndex] = e.target.value
                            return newUserCustomAnswers
                          })
                        }}
                      />
                    </Field>}
                  </>
                ) : (hasUserCustomAnswer(questionIndex) ? (
                  <Field orientation="horizontal" >
                    <Checkbox 
                      id={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`}
                      name={question.answer || ''}
                      checked={true}
                      disabled={true}
                    >
                    </Checkbox>
                    <Label 
                      htmlFor={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`} 
                      className="font-normal truncate">{userCustomAnswer(questionIndex)}</Label>
                  </Field>
                ) : (
                  null
                ))}
              </FieldGroup>
            ) : (
              <RadioGroup 
                className="max-w-sm flex flex-wrap gap-2" 
                value={question.answer}
                onValueChange={(value) => {
                  handleRadioClick(questionIndex, value)
                }}
                disabled={message.data.status !== 'pending' || disabled}>
                {question.options.map((option, index) => {
                  return (
                    <Field orientation="horizontal" key={index} >
                      <RadioGroupItem 
                        id={`${message.data.askId}-${questionIndex}-${option.label}`}
                        value={option.label}
                      >
                      </RadioGroupItem>
                      <FieldLabel 
                        htmlFor={`${message.data.askId}-${questionIndex}-${option.label}`} 
                        className={cn("font-normal truncate", (message.data.status !== 'pending' && question.answer !== option.label) ? 'text-muted-foreground/50' : '')}>{option.label}</FieldLabel>
                    </Field>
                  )
                })}
                {message.data.status === 'pending' ? (
                  <>
                    <Field orientation="horizontal">
                      <RadioGroupItem 
                        id={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`}
                        value="user-custom"
                      >
                      </RadioGroupItem>
                      <FieldLabel htmlFor={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`} className="font-normal" >其他 - 自定义</FieldLabel>
                    </Field>
                    {selections[questionIndex].has('user-custom') && <Field orientation="horizontal" >
                      <Input 
                        value={userCustomAnswers[questionIndex]}
                        placeholder="请输入其他答案"
                        disabled={disabled}
                        onChange={(e) => {
                          setUserCustomAnswers(prev => {
                            const newUserCustomAnswers = [...prev]
                            newUserCustomAnswers[questionIndex] = e.target.value
                            return newUserCustomAnswers
                          })
                        }}
                      />
                    </Field>}
                  </>
                ) : (hasUserCustomAnswer(questionIndex) ? (
                  <Field orientation="horizontal" >
                    <RadioGroupItem 
                      id={`${message.data.askId}-${questionIndex}-${question.answer}-user-custom`}
                      value={question.answer || ''}
                    >
                    </RadioGroupItem>
                    <FieldLabel 
                      htmlFor={`${message.data.askId}-${question.answer}-user-custom`} className="font-normal truncate" >{question.answer}</FieldLabel>
                  </Field>
                ) : (
                  null
                ))}
              </RadioGroup>
            )}
          </div>
          {questionIndex !== (message.data.questions?.length || 0) - 1 && <Separator className="my-2" />}
        </Fragment>
      ))}
      {!disabled && message.data.status === 'pending' && <>
        <Separator className="my-2" />
        <Button variant="secondary" size="sm" className="w-full mt-2" onClick={sumbit} disabled={disabled || !isAllQuestionsAnswered}>
          {isAllQuestionsAnswered ? '提交' : '提交 (未完成)'}
        </Button>
      </>}
    </div>
  )
}
